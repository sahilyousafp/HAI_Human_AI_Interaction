import { join } from "node:path";
import {
  app,
  BrowserWindow,
  session as electronSession,
  ipcMain,
  protocol,
  shell,
  utilityProcess,
} from "electron";
import { APP_SCHEME, appOrigin } from "./app-origin.ts";
import { createAppHandler } from "./app-protocol.ts";
import { type BridgeHandle, type BridgeSession, type ChildLike, startBridge } from "./bridge-process.ts";
import { readDesktopSettings, writeDesktopSettings } from "./desktop-settings.ts";
import { registerSetupIpc } from "./ipc.ts";
import { createLogger, type Logger } from "./log.ts";
import { type ClaudeSetupHolder, createClaudeSetup } from "./setup/claude.ts";
import { claudeDeps } from "./setup/claude-deps.ts";
import {
  CLAUDE_INSTALL_COMMAND,
  CLAUDE_INSTALL_SOURCE,
  CLAUDE_INSTRUCTIONS_URL,
  CLAUDE_PREREQUISITES,
} from "./setup/claude-install.ts";
import { createUpdates, type Updates } from "./updates.ts";
import { makeUpdater } from "./updates-deps.ts";
import { externalTarget, isAppUrl, permissionAllowed } from "./window-rules.ts";

// Must run before the app is ready: the page's origin is secure and can fetch, like https://.
protocol.registerSchemesAsPrivileged([
  { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

/** The app's log file: what the main process and the bridge print. Never holds a token or a camera frame. */
let log: Logger | null = null;
/** `hai://app`, or the web dev server's origin when running from the repository (see appOrigin). */
const origin = appOrigin(process.env.HAI_DESKTOP_DEV_URL, app.isPackaged);
let bridge: BridgeHandle | null = null;
/** What the first-run screen knows about Claude Code; looked at again when the window is brought forward. */
let claude: ClaudeSetupHolder | null = null;
/** Looking for, downloading and restarting into a newer version. */
let updates: Updates | null = null;
/** The bridge's port and token once it listens; null if it never did. The page asks for it before it runs. */
let session: BridgeSession | null = null;

function startBridgeProcess(): Promise<BridgeSession | null> {
  const bridgeDir = join(app.getAppPath(), "dist", "bridge");
  bridge = startBridge({
    entry: join(bridgeDir, "main.js"),
    workspace: app.getPath("userData"),
    origin,
    sampleScene: join(bridgeDir, "samples", "mixed-use-block.hai.json"),
    // The bridge's own lines already start with "[bridge]"; anything else it prints (a crash) gets the tag.
    log: (line) => log?.info(line.startsWith("[bridge]") ? line : `[bridge] ${line}`),
    fork: (entry, env) =>
      utilityProcess.fork(entry, [], {
        env,
        stdio: "pipe",
        serviceName: "HAI bridge",
      }) as unknown as ChildLike,
  });
  return bridge.session.catch((error) => {
    log?.error(error.message);
    return null;
  });
}

function openWindow(): Promise<void> {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false, // shown when the first frame is ready, so there is no white flash
    title: "HAI",
    webPreferences: {
      preload: join(app.getAppPath(), "dist", "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.once("ready-to-show", () => win.show());
  // The user went to install or sign in somewhere else and came back: look again, so the screen is up to date.
  win.on("focus", () => void claude?.recheckOnFocus());

  // The window shows the app's own pages only. A link to the web opens in the user's own browser instead.
  const openInBrowser = (url: string) => {
    const target = externalTarget(url);
    if (target) void shell.openExternal(target);
  };
  win.webContents.setWindowOpenHandler(({ url }) => {
    openInBrowser(url);
    return { action: "deny" };
  });
  const refuseLeaving = (event: { preventDefault(): void }, url: string) => {
    if (isAppUrl(url, origin)) return;
    event.preventDefault();
    openInBrowser(url);
  };
  win.webContents.on("will-navigate", refuseLeaving);
  win.webContents.on("will-redirect", refuseLeaving);
  return win.loadURL(`${origin}/`);
}

/** The camera and the microphone, to the app's own pages; everything else is refused. */
function restrictPermissions(): void {
  const ses = electronSession.defaultSession;
  ses.setPermissionRequestHandler((_contents, permission, callback, details) => {
    const mediaTypes = "mediaTypes" in details ? (details.mediaTypes ?? []) : [];
    callback(permissionAllowed(permission, details.requestingUrl, mediaTypes, origin));
  });
  ses.setPermissionCheckHandler((_contents, permission, requestingOrigin, details) => {
    const mediaTypes = details.mediaType && details.mediaType !== "unknown" ? [details.mediaType] : [];
    return permissionAllowed(permission, details.requestingUrl ?? requestingOrigin, mediaTypes, origin);
  });
}

// One copy at a time: a second launch brings the running window forward and exits, and starts no second bridge.
const primary = app.requestSingleInstanceLock();
if (!primary) app.quit();
app.on("second-instance", () => {
  const win = BrowserWindow.getAllWindows()[0];
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});

app.whenReady().then(async () => {
  if (!primary) return;
  log = createLogger(join(app.getPath("userData"), "logs"));
  process.on("uncaughtException", (error) => log?.error(`uncaught: ${error.stack ?? error.message}`));
  log.info(`HAI ${app.getVersion()} starting (Electron ${process.versions.electron})`);
  restrictPermissions();
  protocol.handle(
    APP_SCHEME,
    createAppHandler({
      web: join(app.getAppPath(), "dist", "web"),
      models: join(app.getPath("userData"), "models"),
    }),
  );
  // Only the app's own pages get the session.
  ipcMain.on("hai:session", (event) => {
    event.returnValue = event.senderFrame && isAppUrl(event.senderFrame.url, origin) ? session : null;
  });
  claude = createClaudeSetup({
    ...claudeDeps,
    info: {
      command: CLAUDE_INSTALL_COMMAND,
      source: CLAUDE_INSTALL_SOURCE,
      instructionsUrl: CLAUDE_INSTRUCTIONS_URL,
    },
    // Nothing is required before Claude Code today; a prerequisite added to the list gets its check here.
    prerequisites: CLAUDE_PREREQUISITES.map((p) => ({ ...p, check: async () => true })),
  });
  const dataDir = app.getPath("userData");
  updates = createUpdates({
    updater: makeUpdater(),
    current: app.getVersion(),
    autoCheck: readDesktopSettings(dataDir).autoCheckUpdates,
    // The bridge ends its agents when it stops; the new program must not start with the old one's still running.
    beforeRestart: stopBridge,
    log: (line) => log?.info(line),
  });
  const setup = registerSetupIpc({
    origin,
    dataDir,
    claude,
    updates,
    saveAutoCheck: (on) => writeDesktopSettings(dataDir, { autoCheckUpdates: on }),
  });
  void setup.models.refresh();
  void claude.recheck();
  updates.start();
  session = await startBridgeProcess();
  if (session) log.addSecret(session.token);
  await openWindow();
});

app.on("window-all-closed", () => app.quit());

// Quitting ends the bridge first, and the bridge ends its agents: killing it would leave them running.
let stopped = false;
/** Stops the bridge once, however it is asked to (quitting, or restarting into an update). */
async function stopBridge(): Promise<void> {
  if (stopped || !bridge) return;
  stopped = true;
  await bridge.stop();
}
app.on("before-quit", (event) => {
  if (stopped || !bridge) return;
  event.preventDefault();
  stopBridge().finally(() => app.quit());
});
