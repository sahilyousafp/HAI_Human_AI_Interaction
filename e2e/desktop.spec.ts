import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  bridgeConnected,
  type Desktop,
  isAlive,
  isPackagedTarget,
  launchDesktop,
  launchSecondInstance,
  removeUserData,
  startWebDevServer,
  TEST_APP_VERSION,
} from "./desktop.ts";
import { watchOutgoingData } from "./privacy.ts";
import { openSettings } from "./settings.ts";

/** Replaces shell.openExternal in the app's main process so a test can see what it was asked to open. */
async function recordExternalOpens(d: Desktop) {
  await d.app.evaluate(({ shell }) => {
    const opened: string[] = [];
    (globalThis as { __opened?: string[] }).__opened = opened;
    shell.openExternal = async (url: string) => {
      opened.push(url);
    };
  });
  return () => d.app.evaluate(() => (globalThis as { __opened?: string[] }).__opened ?? []);
}

const windowCount = (d: Desktop) =>
  d.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);

// The installed app: Electron with its own bridge, serving the built web app from hai://app. Run with
// `pnpm test:e2e:desktop`; the app is staged once by desktop-setup.ts.

let desktop: Desktop | null = null;
test.afterEach(async () => {
  await desktop?.close();
  if (desktop) removeUserData(desktop.userData);
  desktop = null;
});

test.describe("the version", () => {
  test("the top bar and Settings say the version of the app, not a number written into the code", async () => {
    desktop = await launchDesktop();
    const { page } = desktop;
    await bridgeConnected(page);
    expect(await desktop.app.evaluate(({ app }) => app.getVersion())).toBe(TEST_APP_VERSION);
    // The top bar names the bridge's version, which the app passes on.
    await expect(page.getByTestId("bridge-status")).toContainText(`v${TEST_APP_VERSION}`);
    await openSettings(page, "setup");
    await expect(page.getByTestId("setup-updates")).toContainText(`Version ${TEST_APP_VERSION}`);
  });
});

test.describe("launch", () => {
  test("a window opens, the bridge connects and the viewer shows", async () => {
    desktop = await launchDesktop();
    await bridgeConnected(desktop.page);
    await expect(desktop.page.getByTestId("camera-toggle")).toBeVisible();
    expect(desktop.page.url()).toBe("hai://app/");
  });

  test("the page is a secure context on one fixed origin", async () => {
    desktop = await launchDesktop();
    expect(await desktop.page.evaluate(() => [window.isSecureContext, location.origin])).toEqual([
      true,
      "hai://app",
    ]);
  });
});

test.describe("the bridge session", () => {
  test("the page gets its session before it runs, with no lookup on the network", async () => {
    desktop = await launchDesktop();
    const requested: string[] = [];
    desktop.page.on("request", (request) => requested.push(request.url()));
    await desktop.page.reload();
    await bridgeConnected(desktop.page);
    const { port, token } = await desktop.page.evaluate(
      () => (window as unknown as { __HAI_SESSION__: { port: number; token: string } }).__HAI_SESSION__,
    );
    expect(port).toBeGreaterThan(0);
    expect(token.length).toBeGreaterThan(16);
    // Nothing asks for the token, and it is in no address.
    expect(requested.filter((url) => /token|session/i.test(url) || url.includes(token))).toEqual([]);
  });

  test("the page has no Node and no way to reach one", async () => {
    desktop = await launchDesktop();
    const globals = await desktop.page.evaluate(() => ({
      process: typeof (window as unknown as { process?: unknown }).process,
      require: typeof (window as unknown as { require?: unknown }).require,
      electron: typeof (window as unknown as { electron?: unknown }).electron,
      ipcRenderer: typeof (window as unknown as { ipcRenderer?: unknown }).ipcRenderer,
    }));
    expect(globals).toEqual({
      process: "undefined",
      require: "undefined",
      electron: "undefined",
      ipcRenderer: "undefined",
    });
  });

  test("the page can ask what the voice models need, and nothing else is exposed", async () => {
    desktop = await launchDesktop({ keepSetup: true });
    await bridgeConnected(desktop.page);
    const result = await desktop.page.evaluate(async () => {
      const api = (
        window as unknown as { haiDesktop: { models: { state(): Promise<unknown> }; claude: object } }
      ).haiDesktop;
      // The first answer may still be "checking" while the app looks at the disk.
      let state = await api.models.state();
      for (let i = 0; i < 50 && (state as { status: string }).status === "checking"; i++) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        state = await api.models.state();
      }
      return {
        state,
        keys: Object.keys(api),
        modelKeys: Object.keys(api.models).sort(),
        claudeKeys: Object.keys(api.claude).sort(),
      };
    });
    // A fresh data folder holds no voice models: the 14 files of Moonshine and Kokoro, about 390 MB.
    expect(result.state).toMatchObject({ status: "needed", files: 14 });
    expect((result.state as { totalBytes: number }).totalBytes).toBeGreaterThan(380e6);
    expect(result.keys).toEqual(["models", "claude", "updates"]);
    expect(result.modelKeys).toEqual(["cancel", "onChange", "start", "state"]);
    expect(result.claudeKeys).toEqual(["install", "onChange", "openSignIn", "recheck", "state"]);
  });

  test("a reload keeps the same bridge", async () => {
    desktop = await launchDesktop();
    await bridgeConnected(desktop.page);
    const before = desktop.bridgePid();
    await desktop.page.reload();
    await bridgeConnected(desktop.page);
    expect(desktop.bridgePid()).toBe(before);
  });
});

test.describe("quitting", () => {
  test("ends the bridge and the agent process it started", async () => {
    desktop = await launchDesktop();
    await bridgeConnected(desktop.page);
    const bridgePid = desktop.bridgePid();
    expect(bridgePid).not.toBeNull();

    // A long turn, so the agent process is running when the app is closed.
    await expect(desktop.page.getByTestId("agent-status")).toHaveAttribute("data-state", "idle");
    await desktop.page.getByTestId("agent-input").fill("slow");
    await desktop.page.getByTestId("agent-input").press("Enter");
    await expect.poll(() => desktop?.agentPids().length ?? 0, { timeout: 30_000 }).toBeGreaterThan(0);
    const agents = desktop.agentPids();
    for (const pid of agents) expect(isAlive(pid)).toBe(true);

    await desktop.close();
    await expect
      .poll(() => [bridgePid as number, ...agents].filter(isAlive), { timeout: 15_000 })
      .toEqual([]);
  });
});

test.describe("the window stays inside the app", () => {
  test("a link that opens a new window goes to the user's browser", async () => {
    desktop = await launchDesktop();
    await bridgeConnected(desktop.page);
    const opened = await recordExternalOpens(desktop);
    await desktop.page.evaluate(() => {
      const a = document.createElement("a");
      a.href = "https://example.com/docs";
      a.target = "_blank";
      document.body.append(a);
      a.click();
    });
    await expect.poll(opened).toEqual(["https://example.com/docs"]);
    expect(await windowCount(desktop)).toBe(1);
  });

  test("a link in the same window does not navigate and opens in the user's browser", async () => {
    desktop = await launchDesktop();
    await bridgeConnected(desktop.page);
    const opened = await recordExternalOpens(desktop);
    await desktop.page.evaluate(() => {
      location.href = "https://example.com/away";
    });
    await expect.poll(opened).toEqual(["https://example.com/away"]);
    // Asked of the main process: Playwright's page keeps waiting for a navigation the app has cancelled.
    const url = await desktop.app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.webContents.getURL(),
    );
    expect(url).toBe("hai://app/");
  });

  test("addresses that are not web pages open nothing", async () => {
    desktop = await launchDesktop();
    await bridgeConnected(desktop.page);
    const opened = await recordExternalOpens(desktop);
    await desktop.page.evaluate(() => {
      for (const href of ["file:///C:/Windows/System32/calc.exe", "ms-msdt:/id PCWDiagnostic"]) {
        const a = document.createElement("a");
        a.href = href;
        a.target = "_blank";
        document.body.append(a);
        a.click();
      }
    });
    await desktop.page.waitForTimeout(500);
    expect(await opened()).toEqual([]);
    expect(desktop.page.url()).toBe("hai://app/");
  });
});

test.describe("permissions", () => {
  test("the camera is granted to the app's page", async () => {
    desktop = await launchDesktop();
    const tracks = await desktop.page.evaluate(async () => {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      const count = stream.getVideoTracks().length;
      for (const track of stream.getTracks()) track.stop();
      return count;
    });
    expect(tracks).toBe(1);
  });

  test("notifications and location are refused", async () => {
    desktop = await launchDesktop();
    const result = await desktop.page.evaluate(async () => ({
      notifications: await Notification.requestPermission(),
      location: await new Promise<number>((resolve) =>
        navigator.geolocation.getCurrentPosition(
          () => resolve(0),
          (error) => resolve(error.code),
        ),
      ),
    }));
    expect(result.notifications).toBe("denied");
    expect(result.location).toBe(1); // PERMISSION_DENIED
  });
});

test.describe("one copy at a time", () => {
  test("a second launch exits and leaves the first window and bridge alone", async () => {
    desktop = await launchDesktop();
    await bridgeConnected(desktop.page);
    const bridgePid = desktop.bridgePid();
    const second = await launchSecondInstance(desktop.userData);
    expect(second.code).toBe(0);
    expect(second.ms).toBeLessThan(15_000);
    expect(await windowCount(desktop)).toBe(1);
    expect(desktop.bridgePid()).toBe(bridgePid);
    await bridgeConnected(desktop.page);
  });
});

const readLogs = (userData: string): string => {
  const dir = join(userData, "logs");
  try {
    return readdirSync(dir)
      .map((name) => readFileSync(join(dir, name), "utf8"))
      .join("\n");
  } catch {
    return "";
  }
};

test.describe("privacy and logs", () => {
  test("60 s of tracking makes no request beyond the bridge on this machine and sends no image data", async () => {
    test.setTimeout(180_000);
    desktop = await launchDesktop({ clip: "one-hand-pinch" });
    await bridgeConnected(desktop.page);
    const violations = watchOutgoingData(desktop.page);
    // Every request the app's session makes, from the page and from its workers.
    await desktop.app.evaluate(({ session }) => {
      const seen: string[] = [];
      (globalThis as { __requests?: string[] }).__requests = seen;
      session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
        seen.push(details.url);
        callback({});
      });
    });
    // Reload so the recorder sees the page connect; a recorder that sees nothing would pass this test for nothing.
    await desktop.page.reload();
    await bridgeConnected(desktop.page);
    expect(
      (await desktop.app.evaluate(() => (globalThis as { __requests?: string[] }).__requests ?? [])).some(
        (url) => url.startsWith("ws://127.0.0.1:"),
      ),
    ).toBe(true);
    await desktop.page.getByTestId("camera-toggle").click();
    const frames = () =>
      desktop?.page.evaluate(
        () =>
          (window as unknown as { __HAI_TRACKING__?: { frames: unknown[] } }).__HAI_TRACKING__?.frames
            .length ?? 0,
      ) ?? 0;
    await expect.poll(frames, { timeout: 60_000 }).toBeGreaterThan(10);
    await desktop.page.waitForTimeout(60_000);
    const requests = await desktop.app.evaluate(
      () => (globalThis as { __requests?: string[] }).__requests ?? [],
    );
    const remote = requests.filter(
      (url) => /^(https?|wss?|ftp):\/\//.test(url) && !/^(https?|wss?):\/\/127\.0\.0\.1[:/]/.test(url),
    );
    expect(remote).toEqual([]);
    expect(violations()).toEqual([]);
  });

  test("the log records the bridge's start and never holds the session token", async () => {
    desktop = await launchDesktop();
    await bridgeConnected(desktop.page);
    const { token } = await desktop.page.evaluate(
      () => (window as unknown as { __HAI_SESSION__: { token: string } }).__HAI_SESSION__,
    );
    const userData = desktop.userData;
    await expect.poll(() => readLogs(userData)).toContain("[bridge] listening on http://127.0.0.1:");
    const log = readLogs(userData);
    expect(log).toContain("starting (Electron ");
    expect(log).not.toContain(token);
  });
});

test.describe("running from the repository", () => {
  test("shows the web dev server in the window and the bridge connects to it", async () => {
    test.skip(isPackagedTarget, "an installed app never shows the dev server (next test)");
    test.setTimeout(150_000);
    const web = await startWebDevServer(5185);
    try {
      desktop = await launchDesktop({ env: { HAI_DESKTOP_DEV_URL: web.url } });
      await bridgeConnected(desktop.page);
      expect(desktop.page.url()).toBe(`${web.url}/`);
      // The page still gets its session from the app, not from the dev server's own (stale) session file.
      const port = await desktop.page.evaluate(
        () => (window as unknown as { __HAI_SESSION__: { port: number } }).__HAI_SESSION__.port,
      );
      expect(port).toBeGreaterThan(0);
    } finally {
      await web.stop();
    }
  });

  test("an installed app ignores the dev server variable and keeps its own origin", async () => {
    test.skip(!isPackagedTarget, "only a packaged app refuses the variable");
    desktop = await launchDesktop({ env: { HAI_DESKTOP_DEV_URL: "http://127.0.0.1:5185" } });
    await bridgeConnected(desktop.page);
    expect(desktop.page.url()).toBe("hai://app/");
  });
});
