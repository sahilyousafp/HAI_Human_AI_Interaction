import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Message } from "@hai/protocol";
import { parseMessage } from "@hai/protocol";
import { describe, expect, it } from "vitest";
import { readLastProject, writeLastProject } from "./project.ts";
import { SettingsHub } from "./settings.ts";

const LAYOUT = ["section", "select", "measure", null, "move", "massing", "delete", "undo"];
const tempRoot = () => mkdtempSync(join(tmpdir(), "hai-settings-"));
const settingsFile = (root: string) => join(root, ".hai", "settings.json");
const setSettings = (payload: unknown): Message => {
  const parsed = parseMessage(JSON.stringify({ type: "settings.set", id: "m1", payload }));
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.message;
};
const set = (palette: unknown) => setSettings({ palette });

describe("SettingsHub modelling mode", () => {
  it("starts on auto, keeps the choice in the file, and ignores a value it does not know", () => {
    const file = settingsFile(tempRoot());
    const hub = new SettingsHub(file, () => {});
    expect(hub.modelling).toBe("auto");
    hub.handle(setSettings({ modelling: "python" }));
    expect(hub.modelling).toBe("python");
    expect(new SettingsHub(file, () => {}).modelling).toBe("python");
    writeFileSync(file, JSON.stringify({ modelling: "sometimes" }));
    expect(new SettingsHub(file, () => {}).modelling).toBe("auto");
  });
});

describe("SettingsHub features", () => {
  it("reports each feature that was switched on or off, once, and answers featureOn", () => {
    const changes: Array<[string, boolean]> = [];
    const hub = new SettingsHub(
      null,
      () => {},
      (feature, on) => changes.push([feature, on]),
    );
    expect(hub.featureOn("generatedPanels")).toBe(true);
    hub.handle(setSettings({ features: { generatedPanels: false, voice: true } }));
    expect(changes).toEqual([["generatedPanels", false]]);
    expect(hub.featureOn("generatedPanels")).toBe(false);
    hub.handle(setSettings({ features: { generatedPanels: false } }));
    expect(changes).toHaveLength(1);
    hub.handle(setSettings({ features: { generatedPanels: true } }));
    expect(changes.at(-1)).toEqual(["generatedPanels", true]);
  });
});

describe("SettingsHub", () => {
  it("starts with no palette layout (the app's default applies) and greets with it", () => {
    const sent: Message[] = [];
    new SettingsHub(settingsFile(tempRoot()), () => {}).greet((m) => sent.push(m));
    expect(sent).toEqual([
      expect.objectContaining({
        type: "settings.snapshot",
        payload: {
          palette: null,
          createPalette: null,
          gestures: null,
          speech: "device",
          listenForNames: false,
          speakReplies: true,
          replyVoice: "af_heart",
          features: null,
          drawingAids: null,
          showHands: false,
          modelling: "auto",
        },
      }),
    ]);
  });

  it("gesture bindings persist, and changing them keeps the palette layout", () => {
    const file = settingsFile(tempRoot());
    const hub = new SettingsHub(file, () => {});
    hub.handle(set(LAYOUT));
    hub.handle(setSettings({ gestures: { "tap.left": "select", "fist.right": "undo" } }));
    const sent: Message[] = [];
    new SettingsHub(file, () => {}).greet((m) => sent.push(m));
    expect(sent[0]).toMatchObject({
      payload: { palette: LAYOUT, gestures: { "tap.left": "select", "fist.right": "undo" } },
    });
  });

  it("rejects an action a gesture does not offer at the protocol, also in older settings", () => {
    expect(() => setSettings({ gestures: { "drag.left": "undo" } })).toThrow(
      /drag.left cannot be set to undo/,
    );
    expect(() => setSettings({ gestures: { drag: "undo" } })).toThrow(/drag cannot be set to undo/);
  });

  it("feature switches merge and persist, and Show my hands is remembered", () => {
    const file = settingsFile(tempRoot());
    const hub = new SettingsHub(file, () => {});
    hub.handle(setSettings({ features: { createTools: false } }));
    hub.handle(setSettings({ features: { voice: false }, showHands: true }));
    const sent: Message[] = [];
    new SettingsHub(file, () => {}).greet((m) => sent.push(m));
    expect(sent[0]).toMatchObject({
      payload: { features: { createTools: false, voice: false }, showHands: true },
    });
  });

  it("drawing aid switches merge and persist, so changing one never resets another", () => {
    const file = settingsFile(tempRoot());
    const hub = new SettingsHub(file, () => {});
    hub.handle(setSettings({ drawingAids: { ortho: true } }));
    hub.handle(setSettings({ drawingAids: { endpoint: true, grid: false } }));
    const sent: Message[] = [];
    new SettingsHub(file, () => {}).greet((m) => sent.push(m));
    expect(sent[0]).toMatchObject({
      payload: { drawingAids: { ortho: true, endpoint: true, grid: false } },
    });
  });

  it("the create ring's layout persists apart from the tools ring", () => {
    const file = settingsFile(tempRoot());
    new SettingsHub(file, () => {}).handle(setSettings({ createPalette: LAYOUT }));
    const sent: Message[] = [];
    new SettingsHub(file, () => {}).greet((m) => sent.push(m));
    expect(sent[0]).toMatchObject({ payload: { palette: null, createPalette: LAYOUT } });
  });

  it("layout persists: a saved layout is what a restarted bridge greets with", () => {
    const file = settingsFile(tempRoot());
    const broadcast: Message[] = [];
    expect(new SettingsHub(file, (m) => broadcast.push(m)).handle(set(LAYOUT))).toBe(true);
    expect(broadcast).toEqual([
      expect.objectContaining({
        type: "settings.snapshot",
        payload: {
          palette: LAYOUT,
          createPalette: null,
          gestures: null,
          speech: "device",
          listenForNames: false,
          speakReplies: true,
          replyVoice: "af_heart",
          features: null,
          drawingAids: null,
          showHands: false,
          modelling: "auto",
        },
      }),
    ]);

    const sent: Message[] = [];
    new SettingsHub(file, () => {}).greet((m) => sent.push(m));
    expect(sent[0]).toMatchObject({ payload: { palette: LAYOUT } });
  });

  it("listening for names is off by default, and turning it on is remembered", () => {
    const file = settingsFile(tempRoot());
    const greeting = (hub: SettingsHub) => {
      const sent: Message[] = [];
      hub.greet((m) => sent.push(m));
      return sent[0]?.type === "settings.snapshot" ? sent[0].payload.listenForNames : undefined;
    };
    const hub = new SettingsHub(file, () => {});
    expect(greeting(hub)).toBe(false);
    hub.handle({ type: "settings.set", id: "s", payload: { listenForNames: true } });
    expect(greeting(new SettingsHub(file, () => {}))).toBe(true);
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
