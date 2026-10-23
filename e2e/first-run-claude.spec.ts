import { expect, type Page, test } from "@playwright/test";
import type { ClaudeSetup, ClaudeState, ModelsState } from "../packages/protocol/src/desktop.ts";
import { openSettings } from "./settings.ts";

// The Claude Code step of the first-run screen, and Settings > Setup. The page gets a stand-in for the
// `window.haiDesktop` object the desktop app's preload script provides, and the test decides what Claude Code's state is.

const INFO = {
  command: "irm https://claude.ai/install.ps1 | iex",
  source: "https://claude.ai/install.ps1",
  instructionsUrl: "https://code.claude.com/docs/en/setup",
};
const setup = (state: ClaudeState, prerequisites: ClaudeSetup["prerequisites"] = []): ClaudeSetup => ({
  state,
  prerequisites,
  info: INFO,
});
const READY: ClaudeState = { status: "ready", version: "2.1.303" };
const modelsReady: ModelsState = { status: "ready" };
const modelsNeeded: ModelsState = {
  status: "needed",
  files: 14,
  totalBytes: 393_300_000,
  items: [
    { id: "moonshine-base", bytes: 66_700_000 },
    { id: "kokoro", bytes: 326_600_000 },
  ],
};

type Fake = {
  setClaude(next: ClaudeSetup): void;
  setModels(next: ModelsState): void;
  calls: string[];
};

async function installDesktop(page: Page, claude: ClaudeSetup, models: ModelsState = modelsReady) {
  await page.addInitScript(
    ({ claude: firstClaude, models: firstModels }) => {
      let claudeState = firstClaude;
      let modelsState = firstModels;
      const claudeListeners = new Set<(s: unknown) => void>();
      const modelsListeners = new Set<(s: unknown) => void>();
      const calls: string[] = [];
      (window as unknown as { haiDesktop: unknown }).haiDesktop = {
        models: {
          state: async () => modelsState,
          start: async () => void calls.push("models:start"),
          cancel: async () => void calls.push("models:cancel"),
          onChange: (l: (s: unknown) => void) => {
            modelsListeners.add(l);
            return () => modelsListeners.delete(l);
          },
        },
        claude: {
          state: async () => claudeState,
          recheck: async () => {
            calls.push("claude:recheck");
            return claudeState;
          },
          install: async () => void calls.push("claude:install"),
          openSignIn: async () => void calls.push("claude:signin"),
          onChange: (l: (s: unknown) => void) => {
            claudeListeners.add(l);
            return () => claudeListeners.delete(l);
          },
        },
      };
      (window as unknown as { __fake: Fake }).__fake = {
        setClaude(next) {
          claudeState = next;
          for (const l of claudeListeners) l(next);
        },
        setModels(next) {
          modelsState = next;
          for (const l of modelsListeners) l(next);
        },
        calls,
      };
    },
    { claude, models },
  );
}

const setClaude = (page: Page, next: ClaudeSetup) =>
  page.evaluate((s) => (window as unknown as { __fake: Fake }).__fake.setClaude(s), next);
const setModels = (page: Page, next: ModelsState) =>
  page.evaluate((s) => (window as unknown as { __fake: Fake }).__fake.setModels(s), next);
const calls = (page: Page) => page.evaluate(() => (window as unknown as { __fake: Fake }).__fake.calls);
const screen = (page: Page) => page.getByTestId("first-run");
const action = (page: Page, id: string) => page.getByTestId(`first-run-action-${id}`);
const headline = (page: Page) => page.getByTestId("first-run-headline");

test.describe("Claude Code already set up", () => {
  test("shows no screen at all when Claude Code is ready and the voice models are in place", async ({
    page,
  }) => {
    await installDesktop(page, setup(READY));
    await page.goto("/");
    await expect(page.getByTestId("camera-toggle")).toBeVisible();
    await expect(screen(page)).toHaveCount(0);
  });

  test("while the app is still looking, nothing shows yet", async ({ page }) => {
    await installDesktop(page, setup({ status: "checking" }));
    await page.goto("/");
    await expect(page.getByTestId("camera-toggle")).toBeVisible();
    await expect(screen(page)).toHaveCount(0);
  });
});

test.describe("not installed", () => {
  test("shows the exact command and where it comes from, and runs nothing until Install is pressed", async ({
    page,
  }) => {
    await installDesktop(page, setup({ status: "missing" }));
    await page.goto("/");
    await expect(headline(page)).toHaveText("Install Claude Code");
    await expect(screen(page)).toHaveAttribute("data-step", "claude");
    await expect(page.getByTestId("first-run-command")).toHaveText(INFO.command);
    await expect(page.getByTestId("first-run-source")).toHaveText(INFO.source);
    await expect(page.getByTestId("first-run-manual")).toHaveAttribute("href", INFO.instructionsUrl);
    await expect(action(page, "install")).toBeFocused();
    await page.waitForTimeout(500);
    expect(await calls(page)).toEqual([]); // looking at the screen starts nothing

    await action(page, "install").click();
    expect(await calls(page)).toEqual(["claude:install"]);
  });

  test("shows the installer's output while it runs, and moves on to the sign-in when it finishes", async ({
    page,
  }) => {
    await installDesktop(page, setup({ status: "missing" }));
    await page.goto("/");
    await action(page, "install").click();

    await setClaude(page, setup({ status: "installing", output: [] }));
    await expect(headline(page)).toHaveText("Installing Claude Code");
    await expect(screen(page)).toHaveAttribute("data-tone", "busy");
    await expect(page.getByTestId("first-run-command-block")).toHaveCount(0); // it has been shown, and is running
    await expect(page.locator("[data-indeterminate]")).toBeVisible();

    await setClaude(
      page,
      setup({ status: "installing", output: ["Downloading Claude Code...", "Installing..."] }),
    );
    await expect(page.getByTestId("first-run-output")).toContainText("Downloading Claude Code...");
    await expect(page.getByTestId("first-run-output")).toContainText("Installing...");

    await setClaude(page, setup({ status: "signed-out" }));
    await expect(headline(page)).toHaveText("Sign in to Claude");
  });

  test("a failed install keeps the output, says what happened, and offers another try", async ({ page }) => {
    await installDesktop(page, setup({ status: "missing" }));
    await page.goto("/");
    await setClaude(
      page,
      setup({
        status: "install-failed",
        output: ["Access to the path is denied"],
        message: "The installer stopped with an error (exit code 2).",
      }),
    );
    await expect(headline(page)).toHaveText("The installation did not finish");
    await expect(page.getByTestId("first-run-detail")).toContainText("exit code 2");
    await expect(page.getByTestId("first-run-output")).toContainText("Access to the path is denied");
    await expect(page.getByTestId("first-run-manual")).toHaveAttribute("href", INFO.instructionsUrl);
    await action(page, "install").click();
    expect(await calls(page)).toEqual(["claude:install"]);
  });

  test("a prerequisite that is missing is listed and holds the install back", async ({ page }) => {
    await installDesktop(
      page,
      setup({ status: "missing" }, [
        { id: "git", label: "Git for Windows", why: "Gives Claude Code a shell", ok: true },
        { id: "other", label: "Something else", why: "Needed too", ok: false },
      ]),
    );
    await page.goto("/");
    await expect(page.getByTestId("first-run-prerequisite-git")).toHaveAttribute("data-state", "done");
    await expect(page.getByTestId("first-run-prerequisite-other")).toHaveAttribute("data-state", "waiting");
    await expect(page.getByTestId("first-run-prerequisite-other")).toContainText("Needed");
    await expect(action(page, "install")).toBeDisabled();
    // The way out is still there, with the manual instructions.
    await expect(page.getByTestId("first-run-manual")).toBeVisible();
    await expect(action(page, "skip")).toBeEnabled();
  });
});

test.describe("sign-in", () => {
  test("opens Claude Code's own window, waits, and moves on by itself when the account is there", async ({
    page,
  }) => {
    await installDesktop(page, setup({ status: "signed-out" }));
    await page.goto("/");
    await expect(headline(page)).toHaveText("Sign in to Claude");
    await expect(page.getByTestId("first-run-detail")).toContainText("HAI never sees your login");
    await expect(page.getByTestId("first-run-command-block")).toHaveCount(0); // nothing is being installed

    await action(page, "signin").click();
    expect(await calls(page)).toEqual(["claude:signin"]);
    await setClaude(page, setup({ status: "signing-in" }));
    await expect(headline(page)).toHaveText("Waiting for you to sign in");

    await action(page, "recheck").click();
    expect(await calls(page)).toEqual(["claude:signin", "claude:recheck"]);

    await setClaude(page, setup(READY));
    await expect(headline(page)).toHaveText("Claude Code is ready");
    await expect(page.getByTestId("first-run-detail")).toContainText("Version 2.1.303");
    await action(page, "continue").click();
    await expect(screen(page)).toHaveCount(0);
  });

  test("installed but not starting says so and offers to install again", async ({ page }) => {
    await installDesktop(page, setup({ status: "broken" }));
    await page.goto("/");
    await expect(headline(page)).toHaveText("Claude Code did not start");
    await expect(screen(page)).toHaveAttribute("data-tone", "problem");
    await action(page, "install").click();
    expect(await calls(page)).toEqual(["claude:install"]);
  });
});

test.describe("the two steps", () => {
  test("Claude Code comes first, then the voice models, each counted", async ({ page }) => {
    await installDesktop(page, setup({ status: "missing" }), modelsNeeded);
    await page.goto("/");
    await expect(page.locator(".first-run-kicker")).toHaveText("Setting up HAI · Step 1 of 2");
    await expect(headline(page)).toHaveText("Install Claude Code");

    await action(page, "skip").click();
    await expect(page.locator(".first-run-kicker")).toHaveText("Setting up HAI · Step 2 of 2");
    await expect(headline(page)).toHaveText("Download the voice models");
    await expect(screen(page)).toHaveAttribute("data-step", "voice");
  });

  test("when Claude Code is ready, only the voice step shows", async ({ page }) => {
    await installDesktop(page, setup(READY), modelsNeeded);
    await page.goto("/");
    await expect(headline(page)).toHaveText("Download the voice models");
    await expect(screen(page)).toHaveAttribute("data-step", "voice");
  });

  test("a skipped step is remembered, so the screen does not come back at the next launch", async ({
    page,
  }) => {
    await installDesktop(page, setup({ status: "missing" }));
    await page.goto("/");
    await action(page, "skip").click();
    await expect(screen(page)).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId("camera-toggle")).toBeVisible();
    await expect(screen(page)).toHaveCount(0);
  });

  test("Install after a skip clears the choice", async ({ page }) => {
    await installDesktop(page, setup({ status: "missing" }));
    await page.goto("/");
    await action(page, "skip").click();
    expect(await page.evaluate(() => localStorage.getItem("hai.setup.claudeSkipped"))).toBe("1");
    await page.evaluate(() => localStorage.removeItem("hai.setup.claudeSkipped"));
    await page.reload();
    await action(page, "install").click();
    expect(await page.evaluate(() => localStorage.getItem("hai.setup.claudeSkipped"))).toBeNull();
  });

  test("a desktop without a Claude setup API (older shell) shows only the voice step, as before", async ({
    page,
  }) => {
    await page.addInitScript((m) => {
      (window as unknown as { haiDesktop: unknown }).haiDesktop = {
        models: {
          state: async () => m,
          start: async () => {},
          cancel: async () => {},
          onChange: () => () => {},
        },
      };
    }, modelsNeeded);
    await page.goto("/");
    await expect(page.locator(".first-run-kicker")).toHaveText("Setting up HAI");
    await expect(headline(page)).toHaveText("Download the voice models");
  });
});

test.describe("Settings > Setup", () => {
  test("shows where each part stands, and opens the same screens again, whatever was skipped", async ({
    page,
  }) => {
    await installDesktop(page, setup({ status: "signed-out" }), modelsNeeded);
    await page.goto("/");
    await action(page, "skip").click(); // Claude Code
    await action(page, "skip").click(); // voice
    await expect(screen(page)).toHaveCount(0);

    await openSettings(page, "setup");
    await expect(page.getByTestId("setup-claude-status")).toHaveText("Not signed in");
    await expect(page.getByTestId("setup-voice-status")).toHaveText("Not downloaded");

    await page.getByTestId("setup-open").click();
    // The settings close and the same screens come back, from the first step.
    await expect(headline(page)).toHaveText("Sign in to Claude");
    await expect(screen(page)).toHaveAttribute("data-step", "claude");
    await action(page, "skip").click();
    await expect(headline(page)).toHaveText("Download the voice models");
    await action(page, "skip").click();
    await expect(screen(page)).toHaveCount(0);
  });

  test("with everything ready it still shows each step with where it stands, then closes", async ({
    page,
  }) => {
    await installDesktop(page, setup(READY));
    await page.goto("/");
    await openSettings(page, "setup");
    await expect(page.getByTestId("setup-claude-status")).toHaveText("Ready, version 2.1.303");
    await expect(page.getByTestId("setup-voice-status")).toHaveText("Installed");

    await page.getByTestId("setup-open").click();
    await expect(headline(page)).toHaveText("Claude Code is ready");
    await action(page, "continue").click();
    await expect(headline(page)).toHaveText("Voice is ready");
    await action(page, "continue").click();
    await expect(screen(page)).toHaveCount(0);

    // And it can be opened again.
    await openSettings(page, "setup");
    await page.getByTestId("setup-open").click();
    await expect(headline(page)).toHaveText("Claude Code is ready");
  });

  test("does not exist in a browser", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("settings-button").click();
    await expect(page.getByTestId("settings-open-camera")).toBeVisible();
    await expect(page.getByTestId("settings-open-setup")).toHaveCount(0);
  });
});

test.describe("the models step still works after the Claude step", () => {
  test("downloads, with the Claude step skipped", async ({ page }) => {
    await installDesktop(page, setup({ status: "missing" }), modelsNeeded);
    await page.goto("/");
    await action(page, "skip").click();
    await action(page, "download").click();
    expect(await calls(page)).toEqual(["models:start"]);
    await setModels(page, {
      status: "downloading",
      file: "models/kokoro/onnx/model.onnx",
      fileNumber: 9,
      fileCount: 14,
      receivedBytes: 196_650_000,
      totalBytes: 393_300_000,
      items: modelsNeeded.status === "needed" ? modelsNeeded.items : [],
    });
    await expect(page.getByTestId("first-run-progress")).toHaveAttribute("aria-valuenow", "50");
  });
});
