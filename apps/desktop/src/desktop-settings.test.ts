import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readDesktopSettings, settingsPath, writeDesktopSettings } from "./desktop-settings.ts";

const folder = () => mkdtempSync(join(tmpdir(), "hai-desktop-settings-"));

describe("desktop settings", () => {
  it("check for updates automatically, until the user says otherwise", () => {
    expect(readDesktopSettings(folder())).toEqual({ autoCheckUpdates: true });
  });

  it("remember a choice", () => {
    const dir = folder();
    writeDesktopSettings(dir, { autoCheckUpdates: false });
    expect(readDesktopSettings(dir)).toEqual({ autoCheckUpdates: false });
    writeDesktopSettings(dir, { autoCheckUpdates: true });
    expect(readDesktopSettings(dir)).toEqual({ autoCheckUpdates: true });
  });

  it("fall back to the defaults for a file that is damaged or says something odd", () => {
    const dir = folder();
    writeFileSync(settingsPath(dir), "{ not json");
    expect(readDesktopSettings(dir)).toEqual({ autoCheckUpdates: true });
    writeFileSync(settingsPath(dir), '{"autoCheckUpdates":"yes"}');
    expect(readDesktopSettings(dir)).toEqual({ autoCheckUpdates: true });
  });

  it("write a whole file or none: no partial file is left beside it", () => {
    const dir = folder();
    writeDesktopSettings(join(dir, "new", "data"), { autoCheckUpdates: false });
    expect(readdirSync(join(dir, "new", "data"))).toEqual(["desktop.json"]);
    expect(JSON.parse(readFileSync(settingsPath(join(dir, "new", "data")), "utf8"))).toEqual({
      autoCheckUpdates: false,
    });
  });
});
