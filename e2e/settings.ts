import { expect, type Page } from "@playwright/test";

/** The settings sections, by the id their row and page carry. */
export type SettingsSection =
  | "camera"
  | "features"
  | "modelling"
  | "drawing-aids"
  | "gestures"
  | "rings"
  | "voice"
  | "setup"
  | "permissions";

/** Opens the settings sheet, on its first page or on a section's page. */
export async function openSettings(page: Page, section?: SettingsSection): Promise<void> {
  const panel = page.getByTestId("settings-panel");
  if ((await panel.getAttribute("data-open")) !== "true") await page.getByTestId("settings-button").click();
  await expect(panel).toHaveAttribute("data-open", "true");
  if (section && (await page.getByTestId(`settings-page-${section}`).isVisible())) return;
  // The last page is remembered; start from the first page.
  const back = page.getByTestId("settings-back");
  if (await back.isVisible()) await back.click();
  if (section) {
    await page.getByTestId(`settings-open-${section}`).click();
    await expect(page.getByTestId(`settings-page-${section}`)).toBeVisible();
  }
}

/** Closes the settings sheet, so the model is in reach again. */
export async function closeSettings(page: Page): Promise<void> {
  const panel = page.getByTestId("settings-panel");
  if ((await panel.getAttribute("data-open")) === "true") await page.getByTestId("settings-close").click();
  await expect(panel).toHaveAttribute("data-open", "false");
}
