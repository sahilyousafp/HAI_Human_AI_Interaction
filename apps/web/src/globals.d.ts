interface Window {
  /** The desktop app's setup calls, provided by its preload script. Absent in a browser. */
  haiDesktop?: import("@hai/protocol").DesktopApi;
  /** Injected by vite-plugin-hai-session in dev; null when the bridge has not written a session. */
  __HAI_SESSION__?: { port: number; token: string } | null;
}

declare module "rhino3dm/rhino3dm.module.js" {
  export { default } from "rhino3dm";
}
