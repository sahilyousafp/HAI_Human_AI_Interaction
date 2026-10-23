import type { ClaudeSetup, DesktopApi, ModelsState, UpdateState } from "@hai/protocol";
import { contextBridge, ipcRenderer } from "electron";

// Runs before the page's own code, in an isolated world. The page reads `window.__HAI_SESSION__` as it does under
// the dev server; here the value comes from the main process, never from a URL, a file or a request.
contextBridge.exposeInMainWorld("__HAI_SESSION__", ipcRenderer.sendSync("hai:session"));

/** Runs `listener` for each message on `channel` until the returned function is called. */
function subscribe<T>(channel: string, listener: (value: T) => void): () => void {
  const handler = (_event: unknown, value: T) => listener(value);
  ipcRenderer.on(channel, handler);
  return () => {
    ipcRenderer.removeListener(channel, handler);
  };
}

// The first-run screen's calls. Each goes to the main process, which answers only the app's own pages.
const api: DesktopApi = {
  models: {
    state: () => ipcRenderer.invoke("hai:models:state"),
    start: () => ipcRenderer.invoke("hai:models:start"),
    cancel: () => ipcRenderer.invoke("hai:models:cancel"),
    onChange: (listener) => subscribe<ModelsState>("hai:models:changed", listener),
  },
  claude: {
    state: () => ipcRenderer.invoke("hai:claude:state"),
    recheck: () => ipcRenderer.invoke("hai:claude:recheck"),
    install: () => ipcRenderer.invoke("hai:claude:install"),
    openSignIn: () => ipcRenderer.invoke("hai:claude:signin"),
    onChange: (listener) => subscribe<ClaudeSetup>("hai:claude:changed", listener),
  },
  updates: {
    state: () => ipcRenderer.invoke("hai:updates:state"),
    check: () => ipcRenderer.invoke("hai:updates:check"),
    download: () => ipcRenderer.invoke("hai:updates:download"),
    restart: () => ipcRenderer.invoke("hai:updates:restart"),
    setBusy: (busy) => ipcRenderer.invoke("hai:updates:busy", busy),
    setAutoCheck: (on) => ipcRenderer.invoke("hai:updates:auto", on),
    onChange: (listener) => subscribe<UpdateState>("hai:updates:changed", listener),
  },
};
contextBridge.exposeInMainWorld("haiDesktop", api);
