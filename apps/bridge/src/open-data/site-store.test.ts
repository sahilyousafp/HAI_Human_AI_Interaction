import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Message, parseMessage, Site } from "@hai/protocol";
import { describe, expect, it } from "vitest";
import { SiteStore, siteFile } from "./site-store.ts";

const dirs = () =>
  [mkdtempSync(join(tmpdir(), "hai-site-")), mkdtempSync(join(tmpdir(), "hai-site-"))] as const;
const amsterdam = Site.parse({ lat: 52.37, lon: 4.9, northDeg: 12 });
const setMessage = (site: unknown): Message => {
  const parsed = parseMessage(JSON.stringify({ type: "site.set", id: "m1", payload: { site } }));
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.message;
};

describe("SiteStore", () => {
  it("a project without a site has none, and nothing is written", () => {
    const [dir] = dirs();
    const store = new SiteStore(
      () => dir,
      () => {},
    );
    expect(store.site).toBeNull();
  });

  it("saves the site with the project, restores it for a new store, and tells every client", () => {
    const [dir] = dirs();
    const sent: Message[] = [];
    const store = new SiteStore(
      () => dir,
      (m) => sent.push(m),
    );
    store.set(amsterdam);
    expect(JSON.parse(readFileSync(siteFile(dir), "utf8"))).toEqual(amsterdam);
    expect(sent.at(-1)).toMatchObject({ type: "site.snapshot", payload: { site: amsterdam } });
    expect(
      new SiteStore(
        () => dir,
        () => {},
      ).site,
    ).toEqual(amsterdam);
  });

  it("clearing removes it", () => {
    const [dir] = dirs();
    const store = new SiteStore(
      () => dir,
      () => {},
    );
    store.set(amsterdam);
    store.set(null);
    expect(store.site).toBeNull();
    expect(
      new SiteStore(
        () => dir,
        () => {},
      ).site,
    ).toBeNull();
  });

  it("each project has its own site, and opening another reads it and says so", () => {
    const [a, b] = dirs();
    let open = a;
    const sent: Message[] = [];
    const store = new SiteStore(
      () => open,
      (m) => sent.push(m),
    );
    store.set(amsterdam);
    open = b;
    store.projectChanged();
    expect(store.site).toBeNull();
    expect(sent.at(-1)).toMatchObject({ payload: { site: null } });
    open = a;
    store.projectChanged();
    expect(store.site).toEqual(amsterdam);
  });

  it("a damaged file reads as no site", () => {
    const [dir] = dirs();
    new SiteStore(
      () => dir,
      () => {},
    ).set(amsterdam);
    writeFileSync(siteFile(dir), "{ not json");
    expect(
      new SiteStore(
        () => dir,
        () => {},
      ).site,
    ).toBeNull();
    writeFileSync(siteFile(dir), JSON.stringify({ lat: 300, lon: 0 }));
    expect(
      new SiteStore(
        () => dir,
        () => {},
      ).site,
    ).toBeNull();
  });

  it("a client's site.set is the user's own edit, and an invalid latitude never reaches it", () => {
    const [dir] = dirs();
    const store = new SiteStore(
      () => dir,
      () => {},
    );
    expect(store.handle(setMessage({ lat: 40, lon: -3 }))).toBe(true);
    expect(store.site).toMatchObject({ lat: 40, lon: -3, northDeg: 0 });
    expect(
      parseMessage(JSON.stringify({ type: "site.set", id: "m", payload: { site: { lat: 120, lon: 0 } } })).ok,
    ).toBe(false);
    expect(store.handle({ type: "settings.set", id: "x", payload: {} } as Message)).toBe(false);
  });

  it("without an open project there is nowhere to save, and the site is kept in memory", () => {
    const store = new SiteStore(
      () => null,
      () => {},
    );
    store.set(amsterdam);
    expect(store.site).toEqual(amsterdam);
  });
});
