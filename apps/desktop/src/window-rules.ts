import { APP_ORIGIN } from "./app-origin.ts";

/** Whether a URL is one of the app's own pages (or files). */
export function isAppUrl(url: string, origin: string = APP_ORIGIN): boolean {
  return url === origin || url.startsWith(`${origin}/`);
}

/**
 * The address to hand to the user's own browser for a link the window refuses to follow, or null for anything that
 * should not be opened at all (file:, javascript:, other schemes of installed programs).
 */
export function externalTarget(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

/** The only things the page may ask the user's computer for. */
const ALLOWED_PERMISSIONS = new Set(["media"]);

/**
 * Whether a permission request is granted. Camera and microphone ("media") only, and only to the app's own pages;
 * everything else (location, notifications, clipboard, USB, ...) is refused. `mediaTypes` is what a media request
 * asks for; a request for anything but audio and video is refused.
 */
export function permissionAllowed(
  permission: string,
  requestingUrl: string,
  mediaTypes: readonly string[] = [],
  origin: string = APP_ORIGIN,
): boolean {
  if (!ALLOWED_PERMISSIONS.has(permission) || !isAppUrl(requestingUrl, origin)) return false;
  return mediaTypes.every((type) => type === "audio" || type === "video");
}
