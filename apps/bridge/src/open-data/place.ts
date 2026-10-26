import { Site } from "@hai/protocol";
import type { GeoPoint } from "@hai/scene";

/** The refusal an open-data tool gives when it needs a place and has none. */
export const NO_SITE_MESSAGE =
  "The project has no site yet, so there is no place to ask about. Ask the user where the project stands and propose it with site_set (the user decides), or pass latitude and longitude of your own.";

export type PlaceResult = { ok: true; place: GeoPoint; fromSite: boolean } | { ok: false; error: string };

/**
 * The place a tool asks about: the coordinates the agent gave (checked), or else the project's site. Both given means
 * the agent's own, so a question about another place never changes the site. No request is made without a place.
 */
export function placeFor(
  site: Site | null,
  given: { latitude?: number | undefined; longitude?: number | undefined },
): PlaceResult {
  const { latitude, longitude } = given;
  if (latitude !== undefined || longitude !== undefined) {
    if (latitude === undefined || longitude === undefined)
      return { ok: false, error: "Give both latitude and longitude, or neither to use the project's site." };
    const checked = Site.pick({ lat: true, lon: true }).safeParse({ lat: latitude, lon: longitude });
    if (!checked.success)
      return { ok: false, error: "Latitude is from -90 to 90 degrees and longitude from -180 to 180." };
    return { ok: true, place: { lat: checked.data.lat, lon: checked.data.lon }, fromSite: false };
  }
  if (!site) return { ok: false, error: NO_SITE_MESSAGE };
  return { ok: true, place: { lat: site.lat, lon: site.lon }, fromSite: true };
}
