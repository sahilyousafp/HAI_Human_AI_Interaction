import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  agentDir,
  builderCapabilities,
  hasOutdatedSession,
  instructionsVersion,
  migrateSessionToLead,
  readSessionId,
  SYSTEM_PROMPT,
  writeSessionId,
} from "./agent-config.ts";

const project = () => mkdtempSync(join(tmpdir(), "hai-session-"));

/** A session file as it was written before conversations carried the version of the instructions. */
function writeLegacy(dir: string, sessionId: string, agent?: string): string {
  const folder = agentDir(dir, agent);
  mkdirSync(folder, { recursive: true });
  const path = join(folder, "session.json");
  writeFileSync(path, `${JSON.stringify({ sessionId }, null, 2)}\n`);
  return path;
}

describe("the version of the instructions", () => {
  it("is a short stable hash of the base prompt and what the lead is told the team can do", () => {
    expect(instructionsVersion()).toMatch(/^[0-9a-f]{12}$/);
    expect(instructionsVersion()).toBe(instructionsVersion());
  });

  it("also covers the tools the agent was started with", () => {
    expect(instructionsVersion("a,b")).not.toBe(instructionsVersion("a,b,python_run"));
    expect(instructionsVersion("a,b")).toBe(instructionsVersion("a,b"));
  });

  it("a conversation held under other tools is not resumed, and one under the same tools is", () => {
    const dir = project();
    writeSessionId(dir, "s1", "architect", "get_elements");
    expect(readSessionId(dir, "architect", "get_elements")).toBe("s1");
    expect(readSessionId(dir, "architect", "get_elements,python_run")).toBeUndefined();
    expect(hasOutdatedSession(dir, "architect", "get_elements,python_run")).toBe(true);
  });

  it("agents are told to check their work with cameras of their own, and to leave the user's view alone", () => {
    expect(SYSTEM_PROMPT).toMatch(/camera_set/);
    expect(SYSTEM_PROMPT).toMatch(/camera_capture with iso, top, front, left or orbit-sheet/);
    expect(SYSTEM_PROMPT).toMatch(/the user's view never moves/);
    expect(SYSTEM_PROMPT).toMatch(/capture_view only to see what the user is looking at/);
  });

  it("agents are told what the pointed-out lines mean: the held target, the points, the sketches and the markers", () => {
    expect(SYSTEM_PROMPT).toMatch(/"\[context\]".*the target\s+\("this"/s);
    expect(SYSTEM_PROMPT).toMatch(/points P1, P2 their hand rested on/);
    expect(SYSTEM_PROMPT).toMatch(/"\[sketches\]": paths and outlines S1, S2/);
    expect(SYSTEM_PROMPT).toMatch(/"\[markers\]": the project's lettered markers A, B/);
  });

  it("the texts it covers say what the agents must be told about curves", () => {
    expect(SYSTEM_PROMPT).toContain("python_run");
    expect(builderCapabilities(["architect", "product"])).toMatch(/^architect, product can do more than/);
  });
});

describe("saved conversations", () => {
  it("a conversation started under today's instructions is resumed", () => {
    const dir = project();
    writeSessionId(dir, "session-1", "architect");
    expect(readSessionId(dir, "architect")).toBe("session-1");
    expect(hasOutdatedSession(dir, "architect")).toBe(false);
  });

  it("one saved before the version existed is not resumed, and is left in place", () => {
    const dir = project();
    const path = writeLegacy(dir, "old-session", "mochi");
    const before = readFileSync(path, "utf8");
    expect(readSessionId(dir, "mochi")).toBeUndefined();
    expect(hasOutdatedSession(dir, "mochi")).toBe(true);
    expect(readFileSync(path, "utf8")).toBe(before);
  });

  it("one saved under other instructions is not resumed", () => {
    const dir = project();
    const folder = agentDir(dir, "mochi");
    mkdirSync(folder, { recursive: true });
    writeFileSync(
      join(folder, "session.json"),
      JSON.stringify({ sessionId: "older", instructions: "000000000000" }),
    );
    expect(readSessionId(dir, "mochi")).toBeUndefined();
    expect(hasOutdatedSession(dir, "mochi")).toBe(true);
  });

  it("the new conversation takes the place of the old one and is resumed from then on", () => {
    const dir = project();
    writeLegacy(dir, "old-session", "mochi");
    writeSessionId(dir, "new-session", "mochi"); // what the hub does when the fresh conversation starts
    expect(readSessionId(dir, "mochi")).toBe("new-session");
    expect(hasOutdatedSession(dir, "mochi")).toBe(false);
  });

  it("no file, an unreadable file or one without an id is no conversation, and not an outdated one", () => {
    const dir = project();
    expect(readSessionId(dir, "mochi")).toBeUndefined();
    expect(hasOutdatedSession(dir, "mochi")).toBe(false);
    const folder = agentDir(dir, "mochi");
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, "session.json"), "not json");
    expect(readSessionId(dir, "mochi")).toBeUndefined();
    expect(hasOutdatedSession(dir, "mochi")).toBe(false);
    writeFileSync(join(folder, "session.json"), JSON.stringify({ instructions: instructionsVersion() }));
    expect(readSessionId(dir, "mochi")).toBeUndefined();
  });
});

describe("a project from before the team existed", () => {
  it("its conversation moves to the lead with the version it was started under", () => {
    const current = project();
    writeSessionId(current, "kept");
    migrateSessionToLead(current, "mochi");
    expect(readSessionId(current, "mochi")).toBe("kept");

    const legacy = project();
    writeLegacy(legacy, "from-long-ago");
    migrateSessionToLead(legacy, "mochi");
    // Moved, but still from older instructions: not resumed.
    expect(readSessionId(legacy, "mochi")).toBeUndefined();
    expect(hasOutdatedSession(legacy, "mochi")).toBe(true);
    expect(hasOutdatedSession(legacy)).toBe(false);
  });
});
