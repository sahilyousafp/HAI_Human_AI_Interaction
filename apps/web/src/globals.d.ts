interface Window {
  /** Injected by vite-plugin-aex-session in dev; null when the bridge has not written a session. */
  __AEX_SESSION__?: { port: number; token: string } | null;
}

declare module "rhino3dm/rhino3dm.module.js" {
  export { default } from "rhino3dm";
}
