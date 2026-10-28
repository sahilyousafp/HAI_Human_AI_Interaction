import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { fakeProvider } from "../apps/bridge/test/fake-provider.ts";
import { closeSettings, openSettings } from "./settings.ts";
import { openViewer, startTestBridge } from "./viewer.ts";

// What the collapsed chat rail shows, and in what order of priority: Settings > Chat rail.
type Bridge = Awaited<ReturnType<typeof startTestBridge>>;
let bridge: Bridge | null = null;
test.afterEach(async () => {
  await bridge?.stop();
  bridge = null;
});

async function start(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  bridge = await startTestBridge(page, {
    agent: fakeProvider(mkdtempSync(join(tmpdir(), "hai-e2e-strip-"))),
  });
  await openViewer(page);
  await expect(page.getByTestId("agent-status")).toHaveAttribute("data-state", "idle");
}

const strip = (page: Page) => page.getByTestId("agent-strip");
const collapse = (page: Page) => page.getByRole("button", { name: "Hide the agent panel" }).click();
const preset = async (page: Page, id: string) => {
  await openSettings(page, "chat-rail");
  await page.getByTestId(`rail-preset-${id}`).click();
  await closeSettings(page);
};

test("the default is Needs you first: collapsed and idle it shows the state and the microphone, not the name", async ({
  page,
}) => {
  await start(page);
  await collapse(page);
  await expect(strip(page).getByTestId("agent-status")).toBeVisible();
  await expect(strip(page).getByTestId("mic-button")).toBeVisible();
  await expect(strip(page).getByTestId("agent-title")).toHaveCount(0);
  await expect(strip(page)).not.toHaveAttribute("data-alert", "true");
});

test("Needs you first: a request waiting takes the strip over, and answering it gives the strip back", async ({
  page,
}) => {
  await start(page);
  await page.getByTestId("agent-input").fill("shell: echo hi");
  await page.getByTestId("agent-input").press("Enter");
  await expect(page.getByTestId("approval-card")).toHaveAttribute("data-outcome", "pending");
  await collapse(page);
  await expect(strip(page)).toHaveAttribute("data-alert", "true");
  await expect(strip(page).getByTestId("agent-pending-badge")).toHaveText(/1/);
  await expect(strip(page).getByTestId("agent-status")).toHaveCount(0);
  await expect(strip(page).getByTestId("mic-button")).toBeVisible();
  // The badge in the model is still there, and answers it.
  await page.getByTestId("approval-badge").click();
  await page.getByTestId("approval-tag-allow").click();
  await expect(strip(page)).not.toHaveAttribute("data-alert", "true");
});

test("Quiet shows the name; Team shows a dot for each agent; the choice survives a reload", async ({
  page,
}) => {
  await start(page);
  await collapse(page);
  await preset(page, "quiet");
  await expect(strip(page).getByTestId("agent-title")).toBeVisible();
  await expect(strip(page).getByTestId("agent-status")).toBeVisible();
  await preset(page, "team");
  await expect(strip(page).getByTestId("agent-strip-member").first()).toBeVisible();
  expect(await strip(page).getByTestId("agent-strip-member").count()).toBeGreaterThanOrEqual(3);
  await expect(strip(page).getByTestId("agent-title")).toHaveCount(0);
  await page.waitForTimeout(300); // the bridge writes .hai/settings.json
  await page.reload();
  await expect(strip(page).getByTestId("agent-strip-member").first()).toBeVisible();
});

test("a custom list: switch the microphone off and put the name first; the preset says Custom", async ({
  page,
}) => {
  await start(page);
  await collapse(page);
  await preset(page, "quiet");
  await openSettings(page, "chat-rail");
  await page.getByTestId("rail-show-mic").click();
  await page.getByTestId("rail-up-name").click();
  await expect(page.getByTestId("rail-preset-custom")).toHaveAttribute("aria-pressed", "true");
  await closeSettings(page);
  await expect(strip(page).getByTestId("mic-button")).toHaveCount(0);
  const nameY = (await strip(page).getByTestId("agent-title").boundingBox())?.y ?? 0;
  const statusY = (await strip(page).getByTestId("agent-status").boundingBox())?.y ?? 0;
  expect(nameY).toBeLessThan(statusY);
});

test("with a short window the lower items drop and the microphone stays", async ({ page }) => {
  await start(page);
  await collapse(page);
  await preset(page, "quiet");
  await page.setViewportSize({ width: 1440, height: 330 });
  await expect(strip(page).getByTestId("agent-title")).toHaveCount(0);
  await expect(strip(page).getByTestId("mic-button")).toBeVisible();
});
