import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrateLegacyFolder, migrateLegacyProject } from "./legacy.ts";
import { createProject, openProject } from "./project.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "hai-legacy-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const write = (path: string, text: string) => {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
};
const read = (path: string) => readFileSync(path, "utf8");

describe("a folder an older version, named AEX, left behind", () => {
  it("the .aex folder becomes .hai with everything in it, and the tool names follow the server's new name", () => {
    write(join(dir, ".aex", "settings.json"), '{"lastProject":"D:/work/tower"}');
    write(join(dir, ".aex", "agent", "architect", "session.json"), '{"id":"abc"}');
    write(join(dir, ".aex", "approvals.json"), '{"alwaysAllow":["mcp__aex__create_elements","Read"]}');
    write(join(dir, ".aex", "agents.json"), '{"architect":{"aliases":[]}}');
    write(
      join(dir, ".claude", "agents", "architect.md"),
      "---\nname: architect\ntools: mcp__aex__get_elements, Read\n---\n",
    );
    migrateLegacyFolder(dir);
    expect(existsSync(join(dir, ".aex"))).toBe(false);
    expect(read(join(dir, ".hai", "settings.json"))).toBe('{"lastProject":"D:/work/tower"}');
    expect(read(join(dir, ".hai", "agent", "architect", "session.json"))).toBe('{"id":"abc"}');
    expect(read(join(dir, ".hai", "approvals.json"))).toBe(
      '{"alwaysAllow":["mcp__hai__create_elements","Read"]}',
    );
    expect(read(join(dir, ".claude", "agents", "architect.md"))).toContain(
      "tools: mcp__hai__get_elements, Read",
    );
  });

  it("never overwrites a .hai folder that already exists, and does nothing to a folder with nothing old in it", () => {
    write(join(dir, ".aex", "settings.json"), "old");
    write(join(dir, ".hai", "settings.json"), "new");
    migrateLegacyFolder(dir);
    expect(read(join(dir, ".hai", "settings.json"))).toBe("new");
    expect(read(join(dir, ".aex", "settings.json"))).toBe("old");
    const empty = mkdtempSync(join(tmpdir(), "hai-legacy-empty-"));
    migrateLegacyFolder(empty);
    expect(existsSync(join(empty, ".hai"))).toBe(false);
    rmSync(empty, { recursive: true, force: true });
  });

  it("when .hai was created first, the old folder's entries move in and only clashing ones stay behind", () => {
    write(join(dir, ".hai", "e2e", "keep.txt"), "new");
    write(join(dir, ".hai", "settings.json"), "new settings");
    write(join(dir, ".aex", "settings.json"), "old settings");
    write(join(dir, ".aex", "clips", "a.y4m"), "clip");
    write(join(dir, ".aex", "session.json"), "{}");
    migrateLegacyFolder(dir);
    expect(read(join(dir, ".hai", "clips", "a.y4m"))).toBe("clip");
    expect(read(join(dir, ".hai", "session.json"))).toBe("{}");
    expect(read(join(dir, ".hai", "settings.json"))).toBe("new settings");
    expect(read(join(dir, ".hai", "e2e", "keep.txt"))).toBe("new");
    expect(read(join(dir, ".aex", "settings.json"))).toBe("old settings"); // the clash stays
    expect(existsSync(join(dir, ".aex", "clips"))).toBe(false);
  });

  it("a project also gets its scene file and its imported-model assets renamed", () => {
    write(join(dir, "scene.aex.json"), "{}");
    write(join(dir, "assets", "7b1c.aexmesh"), "mesh");
    write(join(dir, "assets", "notes.txt"), "keep");
    migrateLegacyProject(dir);
    expect(existsSync(join(dir, "scene.aex.json"))).toBe(false);
    expect(read(join(dir, "scene.hai.json"))).toBe("{}");
    expect(read(join(dir, "assets", "7b1c.haimesh"))).toBe("mesh");
    expect(read(join(dir, "assets", "notes.txt"))).toBe("keep");
  });

  it("opening an old project folder reads its scene, and creating one over it is refused", () => {
    const scene = {
      version: 1,
      units: "mm",
      up: "Z",
      name: "Old tower",
      levels: [{ id: "L0", name: "Ground", elevation: 0 }],
      elements: {},
    };
    write(join(dir, "scene.aex.json"), JSON.stringify(scene));
    expect(createProject(dir)).toMatchObject({ ok: false });
    const opened = openProject(dir);
    expect(opened).toMatchObject({ ok: true, doc: { name: "Old tower" } });
    expect(existsSync(join(dir, "scene.hai.json"))).toBe(true);
  });
});
