import { Site } from "@hai/protocol";
import { describe, expect, it } from "vitest";
import { NO_SITE_MESSAGE, placeFor } from "./place.ts";

const site = Site.parse({ lat: 52.37, lon: 4.9 });

describe("placeFor", () => {
  it("with no site and no coordinates, says to set the site and how, and no place is returned", () => {
    expect(placeFor(null, {})).toEqual({ ok: false, error: NO_SITE_MESSAGE });
    expect(NO_SITE_MESSAGE).toContain("site_set");
  });

  it("uses the project's site when the agent names no place", () => {
    expect(placeFor(site, {})).toEqual({ ok: true, place: { lat: 52.37, lon: 4.9 }, fromSite: true });
  });

  it("uses the agent's coordinates, even without a site, and leaves the site alone", () => {
    expect(placeFor(site, { latitude: 40, longitude: -3 })).toEqual({
      ok: true,
      place: { lat: 40, lon: -3 },
      fromSite: false,
    });
    expect(placeFor(null, { latitude: 40, longitude: -3 })).toMatchObject({ ok: true, fromSite: false });
  });

  it("refuses half a place and impossible coordinates", () => {
    expect(placeFor(site, { latitude: 40 })).toMatchObject({
      ok: false,
      error: expect.stringContaining("both"),
    });
    expect(placeFor(site, { latitude: 120, longitude: 0 })).toMatchObject({ ok: false });
    expect(placeFor(site, { latitude: 0, longitude: 200 })).toMatchObject({ ok: false });
  });
});
