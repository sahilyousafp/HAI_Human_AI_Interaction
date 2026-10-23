import { app } from "electron";
import { autoUpdater } from "electron-updater";
import type { AppUpdater } from "./updates.ts";

/**
 * electron-updater's updater, for an installed app. Running from the repository there is nothing to update from (the
 * release feed is written into the installed app), so it is null and the app says updating is not available.
 * The end-to-end tests build the app with test/updates-deps-fake.ts in place of this file, to play every update without the
 * network.
 */
export const makeUpdater = (): AppUpdater | null =>
  app.isPackaged ? (autoUpdater as unknown as AppUpdater) : null;
