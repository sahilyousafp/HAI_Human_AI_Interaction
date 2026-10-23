import { BrowserWindow, type IpcMainInvokeEvent, ipcMain } from "electron";
import lock from "../../../scripts/assets.lock.json";
import type { ModelEntry } from "../../../scripts/assets-core.ts";
import type { ClaudeSetupHolder } from "./setup/claude.ts";
import { createModelsDownloader, type ModelsDownloader } from "./setup/models.ts";
import type { Updates } from "./updates.ts";
import { isAppUrl } from "./window-rules.ts";

export interface SetupIpc {
  models: ModelsDownloader;
}

export interface SetupIpcOptions {
  /** The origin of the app's own pages; no other page may call these. */
  origin: string;
  /** The app's data folder, under which `models/` holds the downloaded voice models. */
  dataDir: string;
  claude: ClaudeSetupHolder;
  updates: Updates;
  /** Remembers the user's choice of automatic update checks. */
  saveAutoCheck(on: boolean): void;
}

/** Sends a message to every window that is still open. */
function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  }
}

/**
 * The calls the first-run screen makes (see DesktopApi in @hai/protocol), answered only for the app's own pages. The
 * page reaches them through the preload script's `window.haiDesktop`.
 */
export function registerSetupIpc(options: SetupIpcOptions): SetupIpc {
  const models = createModelsDownloader({ entries: lock.models as ModelEntry[], dir: options.dataDir });
  const { claude, updates } = options;

  const fromApp = (event: IpcMainInvokeEvent) => {
    if (!event.senderFrame || !isAppUrl(event.senderFrame.url, options.origin)) {
      throw new Error("Setup is only available to the app's own pages.");
    }
  };
  ipcMain.handle("hai:models:state", (event) => {
    fromApp(event);
    return models.state();
  });
  ipcMain.handle("hai:models:start", (event) => {
    fromApp(event);
    return models.start();
  });
  ipcMain.handle("hai:models:cancel", (event) => {
    fromApp(event);
    models.cancel();
  });
  models.onChange((state) => broadcast("hai:models:changed", state));

  ipcMain.handle("hai:claude:state", (event) => {
    fromApp(event);
    return claude.snapshot();
  });
  ipcMain.handle("hai:claude:recheck", (event) => {
    fromApp(event);
    return claude.recheck();
  });
  ipcMain.handle("hai:claude:install", (event) => {
    fromApp(event);
    return claude.install();
  });
  ipcMain.handle("hai:claude:signin", (event) => {
    fromApp(event);
    return claude.openSignIn();
  });
  claude.onChange((setup) => broadcast("hai:claude:changed", setup));

  ipcMain.handle("hai:updates:state", (event) => {
    fromApp(event);
    return updates.state();
  });
  ipcMain.handle("hai:updates:check", (event) => {
    fromApp(event);
    return updates.check();
  });
  ipcMain.handle("hai:updates:download", (event) => {
    fromApp(event);
    return updates.download();
  });
  ipcMain.handle("hai:updates:restart", (event) => {
    fromApp(event);
    return updates.restart();
  });
  ipcMain.handle("hai:updates:busy", (event, busy: unknown) => {
    fromApp(event);
    updates.setBusy(busy === true);
  });
  ipcMain.handle("hai:updates:auto", (event, on: unknown) => {
    fromApp(event);
    updates.setAutoCheck(on === true);
    options.saveAutoCheck(on === true);
  });
  updates.onChange((state) => broadcast("hai:updates:changed", state));

  return { models };
}
