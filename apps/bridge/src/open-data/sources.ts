import { OPEN_DATA_SOURCES, STARTER_PORTALS } from "@hai/protocol";

/** The hosts a source may contact: its own, or for the portals the starter list plus the user's. */
export function sourceHosts(sourceId: string, userPortalHosts: readonly string[]): readonly string[] {
  if (sourceId === "portals") return [...STARTER_PORTALS.map((p) => p.host), ...userPortalHosts];
  return OPEN_DATA_SOURCES.find((s) => s.id === sourceId)?.hosts ?? [];
}

/** The identifying User-Agent every request carries (some services refuse requests without one). */
export const openDataUserAgent = (version: string) =>
  `HAI/${version} (open-source design tool; https://github.com/sahilyousafp/HAI_Human_AI_Interaction)`;
