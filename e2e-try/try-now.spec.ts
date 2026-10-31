import { join } from "node:path";
import { expect, test } from "@playwright/test";

// The Try now site: the same app with its own scene in the page. A visitor sees a sample building, can import a Rhino
// model, undo, clear the model and save a .3dm, and nothing reaches a bridge (there is none).

const MODELS = join(import.meta.dirname, "..", "test-assets", "models");

test.beforeEach(async ({ page }) => {
  // Anything that tries a socket or a request to a bridge on this machine is a mistake in this build.
  page.on("websocket", (socket) => {
    throw new Error(`the Try now build opened a WebSocket: ${socket.url()}`);
  });
  await page.goto("/try/");
  await expect(page.getByTestId("project-status")).toContainText("Mixed-use block");
});

test("shows the sample building, running in the tab, with no project buttons", async ({ page }) => {
  await expect(page.getByTestId("project-status")).toContainText("nothing is saved");
  await expect(page.getByText("Running here")).toBeVisible();
  await expect(page.getByTestId("open-project")).toHaveCount(0);
  await expect(page.getByTestId("new-project")).toHaveCount(0);
  await expect(page.getByTestId("clear-model")).toBeEnabled();
  await expect(page.getByTestId("import-button")).toBeVisible();
  // The way back to the site, and a command box wide enough to read what it says.
  await expect(page.getByTestId("site-link")).toHaveAttribute("href", "/");
  const input = page.getByPlaceholder(/Type a command/);
  expect((await input.boundingBox())?.width ?? 0).toBeGreaterThan(240);
  // No chat with Claude and no voice: the commands bar is what is there to type into.
  await expect(page.getByRole("button", { name: "Speak to the agent" })).toHaveCount(0);
});

test("a visitor can import their own .3dm, see it, undo the import, and save the model back as a .3dm", async ({
  page,
}) => {
  await page.getByTestId("clear-model").click();
  await expect(page.getByTestId("clear-model")).toBeDisabled();
  await page.getByTestId("import-input").setInputFiles(join(MODELS, "metres-box.3dm"));
  await expect(page.getByTestId("import-summary")).toContainText("Imported", { timeout: 30_000 });
  // The imported geometry is drawn: the model is no longer empty, so Save as 3dm has something to write.
  const download = page.waitForEvent("download", { timeout: 30_000 });
  await page.getByTestId("save-3dm").click();
  expect((await download).suggestedFilename()).toMatch(/\.3dm$/);
  await expect(page.getByTestId("export-summary")).toContainText("Saved");
  // One undo takes the import away.
  await page.keyboard.press("Control+z");
  await expect(page.getByTestId("clear-model")).toBeDisabled();
});

test("Clear empties the model and Undo brings the sample back", async ({ page }) => {
  await page.getByTestId("clear-model").click();
  await expect(page.getByTestId("clear-model")).toBeDisabled();
  await page.keyboard.press("Control+z");
  await expect(page.getByTestId("clear-model")).toBeEnabled();
});

test("a typed command works with no agent: select all walls and move them 2 m up", async ({ page }) => {
  const box = page.getByPlaceholder(/Type a command/);
  await box.fill("select all walls and move 2 m up");
  await box.press("Enter");
  await expect(page.getByTestId("tool-notice")).toContainText(/move 2 m up/i);
  // The change is one undo step: the Undo button takes it back (Ctrl+Z is the text box's while it has focus).
  await page.getByRole("button", { name: "Undo", exact: true }).first().click();
  await expect(page.getByRole("button", { name: "Redo", exact: true }).first()).toBeEnabled();
});

test("makes no request to a bridge or to the speech models", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  await page.reload();
  await expect(page.getByTestId("project-status")).toContainText("Mixed-use block");
  await page.waitForTimeout(1500);
  expect(
    requests.filter((url) =>
      /127\.0\.0\.1:(48|49)\d\d|\/health|\/models\/(kokoro|moonshine)|\/ort\//.test(url),
    ),
  ).toEqual([]);
});
