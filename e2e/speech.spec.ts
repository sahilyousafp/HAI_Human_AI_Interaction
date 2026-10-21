import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import type { Bridge } from "../apps/bridge/src/server.ts";
import { fakeProvider } from "../apps/bridge/test/fake-provider.ts";
import { watchOutgoingData } from "./privacy.ts";
import { closeSettings, openSettings } from "./settings.ts";
import { openViewer, startTestBridge } from "./viewer.ts";

// Mochi's spoken replies with the Kokoro voice. They need WebGPU (docs/decisions.md): on a machine without it
// (CI runners) the app speaks with an installed voice instead, and these tests are skipped.

let bridge: Bridge | null = null;
test.afterEach(async () => {
  await bridge?.stop();
  bridge = null;
});
test.setTimeout(180_000);

/** Every request to a host other than this machine (a speech service would be one). */
function watchRemoteHosts(page: Page): () => string[] {
  const remote: string[] = [];
  page.on("request", (request) => {
    const { hostname } = new URL(request.url());
    if (!["127.0.0.1", "localhost", "[::1]"].includes(hostname)) remote.push(request.url());
  });
  return () => remote;
}

async function start(page: Page) {
  bridge = await startTestBridge(page, {
    agent: fakeProvider(mkdtempSync(join(tmpdir(), "aex-speech-"))),
    speak: true,
  });
  await openViewer(page);
  const webgpu = await page.evaluate(async () => {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    return Boolean(gpu && (await gpu.requestAdapter()));
  });
  test.skip(!webgpu, "No WebGPU on this machine: replies use an installed voice");
  await expect(page.getByTestId("agent-status")).toHaveAttribute("data-state", "idle");
}

async function ask(page: Page, text: string) {
  await page.getByTestId("agent-input").fill(text);
  await page.getByTestId("agent-input").press("Enter");
}

const speaking = (page: Page) => page.getByTestId("speak-toggle");

test("round trip: what the voice says is heard back by the recogniser", async ({ page }) => {
  await start(page);
  const remote = watchRemoteHosts(page);
  const heard = await page.evaluate(() =>
    window.__AEX_SPEECH__?.roundTrip("Architect is working on the stair core."),
  );
  const words = (heard ?? "").toLowerCase();
  // Heard as "architect is working on the staircor." on the reference laptop: the recogniser joins the last words.
  expect(words).toMatch(/architect is working on the stair ?cor/);
  await openSettings(page, "voice");
  await expect(page.getByTestId("reply-engine")).toHaveText("Kokoro on this laptop (WebGPU)");
  expect(remote()).toEqual([]);
});

test("first sentence starts early, and no speech service is called", async ({ page }) => {
  await start(page);
  await page.evaluate(() => window.__AEX_SPEECH__?.roundTrip("Ready.")); // the voice is loaded
  const remote = watchRemoteHosts(page);
  const outgoing = watchOutgoingData(page);
  await ask(page, "two sentences");
  // Speaking starts while the reply's second sentence has not arrived yet.
  await expect(speaking(page)).toHaveAttribute("data-speaking", "true");
  await expect(page.getByTestId("agent-turn").last()).toHaveAttribute("data-ended", "running");
  await expect(page.getByTestId("agent-turn").last()).toHaveAttribute("data-ended", "done");
  await expect(speaking(page)).toHaveAttribute("data-speaking", "false", { timeout: 20_000 });
  await openSettings(page, "voice");
  await expect(page.getByTestId("reply-latency")).not.toHaveText("-");
  expect(remote()).toEqual([]);
  expect(outgoing()).toEqual([]);
});

test("talking interrupts: pressing the microphone stops the voice before listening starts", async ({
  page,
}) => {
  await start(page);
  await page.evaluate(() => window.__AEX_SPEECH__?.roundTrip("Ready."));
  await ask(page, "two sentences");
  await expect(speaking(page)).toHaveAttribute("data-speaking", "true");
  await page.getByTestId("mic-button").click();
  await expect(speaking(page)).toHaveAttribute("data-speaking", "false");
  await expect(page.getByTestId("mic-indicator")).toHaveAttribute("data-state", "on");
});

test("muted: the reply appears in the panel and nothing is spoken; muting is remembered", async ({
  page,
}) => {
  await start(page);
  await speaking(page).click();
  await expect(speaking(page)).toHaveAttribute("aria-pressed", "true");
  await openSettings(page, "voice");
  await expect(page.getByTestId("speak-replies")).not.toBeChecked();
  await closeSettings(page);
  await ask(page, "two sentences");
  await expect(page.getByTestId("agent-turn").last()).toHaveAttribute("data-ended", "done");
  await expect(page.getByTestId("agent-turn").last()).toContainText("Climate is running the winter study.");
  await expect(speaking(page)).toHaveAttribute("data-speaking", "false");
  expect(await page.evaluate(() => window.__AEX_SPEECH__?.speaker.getSnapshot().firstAudio.length)).toBe(0);
  await page.reload();
  await openViewer(page);
  await expect(speaking(page)).toHaveAttribute("aria-pressed", "true");
});
