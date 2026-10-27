import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Message, parseMessage } from "@hai/protocol";
import { describe, expect, it } from "vitest";
import { MarkerStore, markersFile } from "./markers.ts";

const set = (markers: unknown): Message => {
  const parsed = parseMessage(JSON.stringify({ type: "markers.set", id: "m1", payload: { markers } }));
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.message;
};

describe("MarkerStore", () => {
  it("keeps the markers in the project, tells every client, and reads them again after a restart", () => {
    const dir = mkdtempSync(join(tmpdir(), "hai-markers-"));
    const sent: Message[] = [];
    const store = new MarkerStore(
      () => dir,
      (m) => sent.push(m),
    );
    const markers = [
      { letter: "B", point: [9000, 9000, 0] },
      { letter: "A", point: [3000, 4000, 0] },
    ];
    expect(store.handle(set(markers))).toBe(true);
    expect(sent.at(-1)).toMatchObject({
      type: "markers.snapshot",
      payload: { markers: [markers[1], markers[0]] },
    });
    expect(JSON.parse(readFileSync(markersFile(dir), "utf8"))).toEqual([markers[1], markers[0]]);
    const greeted: Message[] = [];
    new MarkerStore(
      () => dir,
      () => {},
    ).greet((m) => greeted.push(m));
    expect(greeted[0]).toMatchObject({ payload: { markers: [markers[1], markers[0]] } });
  });

  it("removes the file when the last marker goes, and has none for a project without one", () => {
    const dir = mkdtempSync(join(tmpdir(), "hai-markers-"));
    const store = new MarkerStore(
      () => dir,
      () => {},
    );
    store.handle(set([{ letter: "A", point: [0, 0, 0] }]));
    store.handle(set([]));
    expect(existsSync(markersFile(dir))).toBe(false);
    expect(
      new MarkerStore(
        () => dir,
        () => {},
      ).markers,
    ).toEqual([]);
  });

  it("reads the new project's markers when another project opens", () => {
    const first = mkdtempSync(join(tmpdir(), "hai-markers-"));
    const second = mkdtempSync(join(tmpdir(), "hai-markers-"));
    let dir = first;
    const sent: Message[] = [];
    const store = new MarkerStore(
      () => dir,
      (m) => sent.push(m),
    );
    store.handle(set([{ letter: "A", point: [0, 0, 0] }]));
    dir = second;
    store.projectChanged();
    expect(sent.at(-1)).toMatchObject({ payload: { markers: [] } });
  });

  it("refuses a list that uses a letter twice", () => {
    const raw = JSON.stringify({
      type: "markers.set",
      id: "m1",
      payload: {
        markers: [
          { letter: "A", point: [0, 0, 0] },
          { letter: "A", point: [1, 0, 0] },
        ],
      },
    });
    expect(parseMessage(raw).ok).toBe(false);
  });
});
