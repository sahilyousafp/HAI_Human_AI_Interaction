/**
 * The address of a file the site serves (a model, a WebAssembly build), for code that must give workers a full address.
 * It follows Vite's `base`, so the same build works at the root (the app and the desktop app) and under a path (the Try
 * now site at /try/).
 */
export function siteUrl(path: string): string {
  return new URL(`${import.meta.env.BASE_URL}${path.replace(/^\//, "")}`, location.origin).href;
}
