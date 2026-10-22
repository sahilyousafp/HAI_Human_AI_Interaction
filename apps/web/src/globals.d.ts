interface Window {
  /** Injected by vite-plugin-hai-session in dev; null when the bridge has not written a session. */
  __HAI_SESSION__?: { port: number; token: string } | null;
}

declare module "rhino3dm/rhino3dm.module.js" {
  export { default } from "rhino3dm";
}
