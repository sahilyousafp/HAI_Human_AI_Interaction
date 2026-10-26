import type { Message } from "@hai/protocol";
import { describe, expect, it } from "vitest";
import { parseSiteFields } from "./OpenDataSettings.tsx";
import { OpenDataStore } from "./open-data-store.ts";

function setup() {
  const sent: Message[] = [];
  const store = new OpenDataStore((m) => {
    sent.push(m);
    return true;
  });
  const bridge = (type: string, payload: unknown) => store.handle({ type, id: "b", payload } as Message);
  return { store, sent, bridge };
}

const snapshot = (extra: Record<string, unknown> = {}) => ({
  openDataSources: {},
  openDataAcknowledged: [],
  portalHosts: [],
  showContext: true,
  ...extra,
});

describe("OpenDataStore", () => {
  it("reads the choices from a settings snapshot without consuming it", () => {
    const t = setup();
    const consumed = t.bridge(
      "settings.snapshot",
      snapshot({
        openDataSources: { overpass: false },
        openDataAcknowledged: ["open-meteo"],
        portalHosts: ["data.example.org"],
        showContext: false,
      }),
    );
    expect(consumed).toBe(false);
    expect(t.store.getSnapshot()).toMatchObject({
      sources: { overpass: false },
      acknowledged: ["open-meteo"],
      portalHosts: ["data.example.org"],
      showContext: false,
    });
  });

  it("holds the site and the record the bridge sends", () => {
    const t = setup();
    expect(t.bridge("site.snapshot", { site: { lat: 1, lon: 2, northDeg: 0, anchorMm: [0, 0] } })).toBe(true);
    expect(t.store.getSnapshot().site).toMatchObject({ lat: 1, lon: 2 });
    expect(
      t.bridge("opendata.record", {
        entries: [
          { at: 1, source: "overpass", host: "overpass-api.de", kind: "buildings", cached: false, bytes: 9 },
        ],
      }),
    ).toBe(true);
    expect(t.store.getSnapshot().record).toHaveLength(1);
  });

  it("a switch shows at once and is sent to the bridge", () => {
    const t = setup();
    t.store.setSource("overpass", false);
    expect(t.store.getSnapshot().sources.overpass).toBe(false);
    expect(t.sent.at(-1)).toMatchObject({
      type: "settings.set",
      payload: { openDataSources: { overpass: false } },
    });
    t.store.acknowledge("open-meteo");
    expect(t.store.getSnapshot().acknowledged).toEqual(["open-meteo"]);
    expect(t.sent.at(-1)).toMatchObject({ payload: { openDataAcknowledged: ["open-meteo"] } });
    t.store.setShowContext(false);
    expect(t.sent.at(-1)).toMatchObject({ payload: { showContext: false } });
    t.store.setPortalHosts(["data.example.org"]);
    expect(t.sent.at(-1)).toMatchObject({ payload: { portalHosts: ["data.example.org"] } });
  });

  it("sets and clears the site, and clears the record, through the bridge", () => {
    const t = setup();
    const site = { lat: 52.37, lon: 4.9, northDeg: 0, anchorMm: [0, 0] as [number, number] };
    t.store.setSite(site);
    expect(t.sent.at(-1)).toMatchObject({ type: "site.set", payload: { site } });
    t.store.setSite(null);
    expect(t.sent.at(-1)).toMatchObject({ type: "site.set", payload: { site: null } });
    t.store.clearRecord();
    expect(t.sent.at(-1)).toMatchObject({ type: "opendata.clear" });
  });
});

describe("the site form", () => {
  const fields = { lat: "52.37", lon: "4,9", north: "", x: "", y: "" };

  it("accepts numbers (a comma decimal too) and defaults north and the anchor", () => {
    expect(parseSiteFields(fields)).toEqual({
      ok: true,
      site: { lat: 52.37, lon: 4.9, northDeg: 0, anchorMm: [0, 0] },
    });
  });

  it("says what is wrong, in words", () => {
    expect(parseSiteFields({ ...fields, lat: "" })).toMatchObject({
      ok: false,
      error: expect.stringContaining("numbers"),
    });
    expect(parseSiteFields({ ...fields, lat: "120" })).toMatchObject({
      ok: false,
      error: "Latitude must be from -90 to 90 degrees.",
    });
    expect(parseSiteFields({ ...fields, lon: "200" })).toMatchObject({
      ok: false,
      error: expect.stringContaining("Longitude"),
    });
    expect(parseSiteFields({ ...fields, north: "270" })).toMatchObject({
      ok: false,
      error: expect.stringContaining("North angle"),
    });
    expect(parseSiteFields({ ...fields, lat: "abc" })).toMatchObject({ ok: false });
  });
});
