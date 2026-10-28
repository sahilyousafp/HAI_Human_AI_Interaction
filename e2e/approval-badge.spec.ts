import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { fakeProvider } from "../apps/bridge/test/fake-provider.ts";
import { openViewer, startTestBridge } from "./viewer.ts";

// A permission request waits as a pulsing badge in the model, on what it concerns; a pinch on the badge opens it.
type Bridge = Awaited<ReturnType<typeof startTestBridge>>;
let bridge: Bridge | null = null;
test.afterEach(async () => {
  await bridge?.stop();
  bridge = null;
});

async function start(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  bridge = await startTestBridge(page, {
    agent: fakeProvider(mkdtempSync(join(tmpdir(), "hai-e2e-badge-"))),
  });
  await openViewer(page);
}

const ask = async (page: Page, text: string) => {
  await expect(page.getByTestId("agent-status")).toHaveAttribute("data-state", "idle");
  await page.getByTestId("agent-input").fill(text);
  await page.getByTestId("agent-input").press("Enter");
};

const badge = (page: Page) => page.getByTestId("approval-badge");

test("a request is a badge in the model; opening it shows the tag, and Allow answers it", async ({
  page,
}) => {
  await start(page);
  await expect(badge(page)).toHaveCount(0);
  await ask(page, "shell: echo hi");
  await expect(badge(page)).toHaveCount(1);
  // Quiet until looked at: the tag is closed.
  await expect(page.getByTestId("approval-tag")).toHaveCount(0);
  await badge(page).click();
  const tag = page.getByTestId("approval-tag");
  await expect(tag).toContainText("Allow Bash?");
  await expect(tag).toContainText("echo hi");
  await tag.getByTestId("approval-tag-allow").click();
  await expect(page.getByTestId("approval-card").getByTestId("approval-outcome")).toHaveText("Allowed");
  await expect(badge(page)).toHaveCount(0);
  await expect(page.getByTestId("agent-turn").last().getByTestId("agent-text")).toHaveText(
    "Done: ran: echo hi",
  );
});

test("Deny in the tag denies the call", async ({ page }) => {
  await start(page);
  await ask(page, "shell: rm -rf build");
  await badge(page).click();
  await page.getByTestId("approval-tag-deny").click();
  await expect(page.getByTestId("approval-card").getByTestId("approval-outcome")).toHaveText("Denied");
  await expect(badge(page)).toHaveCount(0);
});

test("a nod still answers without opening the badge", async ({ page }) => {
  await start(page);
  await ask(page, "shell: echo hi");
  await expect(badge(page)).toHaveCount(1);
  await page.evaluate(() => window.__HAI_INPUT__?.engaged(true));
  await page.evaluate(() =>
    window.__HAI_INPUT__?.gestures([{ type: "head.nod", ts: Date.now(), confidence: 1 }]),
  );
  await expect(page.getByTestId("approval-card").getByTestId("approval-outcome")).toHaveText("Allowed");
  await expect(badge(page)).toHaveCount(0);
});
