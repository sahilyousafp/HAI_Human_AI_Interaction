import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Message } from "@aex/protocol";
import { parseMessage } from "@aex/protocol";
import { describe, expect, it } from "vitest";
import { readLastProject, writeLastProject } from "./project.ts";
import { SettingsHub } from "./settings.ts";

const LAYOUT = ["section", "select", "measure", null, "move", "massing", "delete", "undo"];
const tempRoot = () => mkdtempSync(join(tmpdir(), "aex-settings-"));
const settingsFile = (root: string) => join(root, ".aex", "settings.json");
const set = (palette: unknown): Message => {
  const parsed = parseMessage(JSON.stringify({ type: "settings.set", id: "m1", payload: { palette } }));
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.message;
};

describe("SettingsHub", () => {
  it("starts with no palette layout (the app's default applies) and greets with it", () => {
    const sent: Message[] = [];
    new SettingsHub(settingsFile(tempRoot()), () => {}).greet((m) => sent.push(m));
    expect(sent).toEqual([
      expect.objectContaining({ type: "settings.snapshot", payload: { palette: null } }),
    ]);
  });

  it("layout persists: a saved layout is what a restarted bridge greets with", () => {
    const file = settingsFile(tempRoot());
    const broadcast: Message[] = [];
    expect(new SettingsHub(file, (m) => broadcast.push(m)).handle(set(LAYOUT))).toBe(true);
    expect(broadcast).toEqual([
      expect.objectContaining({ type: "settings.snapshot", payload: { palette: LAYOUT } }),
    ]);

    const sent: Message[] = [];
    new SettingsHub(file, () => {}).greet((m) => sent.push(m));
    expect(sent[0]).toMatchObject({ payload: { palette: LAYOUT } });
  });

  it("keeps the other settings in the file (the last opened project)", () => {
    const root = tempRoot();
    writeLastProject(root, "D:/Projects/Tower");
    new SettingsHub(settingsFile(root), () => {}).handle(set(LAYOUT));
    expect(readLastProject(root)).toBe("D:/Projects/Tower");
    expect(JSON.parse(readFileSync(settingsFile(root), "utf8")).palette).toEqual(LAYOUT);
  });

  it("ignores a stored layout that is not valid", () => {
    const root = tempRoot();
    writeLastProject(root, "x");
    writeFileSync(settingsFile(root), JSON.stringify({ palette: ["only one"] }));
    const sent: Message[] = [];
    new SettingsHub(settingsFile(root), () => {}).greet((m) => sent.push(m));
    expect(sent[0]).toMatchObject({ payload: { palette: null } });
  });

  it("rejects a layout without exactly 8 slots at the protocol", () => {
    expect(() => set(["select"])).toThrow();
  });

  it("does not handle other messages", () => {
    const hub = new SettingsHub(null, () => {});
    const parsed = parseMessage(JSON.stringify({ type: "scene.undo", id: "m2", payload: {} }));
    if (!parsed.ok) throw new Error(parsed.error);
    expect(hub.handle(parsed.message)).toBe(false);
  });
});
