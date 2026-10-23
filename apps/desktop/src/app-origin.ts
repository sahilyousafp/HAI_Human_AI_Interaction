/** The scheme the app serves its pages from. Registered as privileged in main.ts before the app is ready. */
export const APP_SCHEME = "hai";

/** The one origin of the installed app. It must never change: the page keeps its settings by origin. */
export const APP_ORIGIN = `${APP_SCHEME}://app`;

/**
 * The origin the window shows. The installed app always uses `hai://app`. Only an app that is not installed
 * (running from the repository, as `pnpm dev:desktop` does) may show the web dev server instead, named in
 * HAI_DESKTOP_DEV_URL, so the page reloads as the code changes; an environment variable must never be able to
 * point an installed app at another page.
 */
export function appOrigin(devUrl: string | undefined, packaged: boolean): string {
  if (!devUrl || packaged) return APP_ORIGIN;
  try {
    const url = new URL(devUrl);
    return url.protocol === "http:" && url.hostname === "127.0.0.1" ? url.origin : APP_ORIGIN;
  } catch {
    return APP_ORIGIN;
  }
}
