import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** What the desktop app itself remembers (the web app's settings live in the bridge's `.hai/settings.json`). */
export interface DesktopSettings {
  /** Whether the app looks for a newer version by itself (on start, then once a day). Default: yes. */
  autoCheckUpdates: boolean;
}

const DEFAULTS: DesktopSettings = { autoCheckUpdates: true };

export const settingsPath = (dataDir: string): string => join(dataDir, "desktop.json");

/** Reads the settings; a missing, unreadable or odd file gives the defaults, never an error. */
export function readDesktopSettings(dataDir: string): DesktopSettings {
  try {
    const raw = JSON.parse(readFileSync(settingsPath(dataDir), "utf8")) as Partial<DesktopSettings>;
    return {
      autoCheckUpdates:
        typeof raw.autoCheckUpdates === "boolean" ? raw.autoCheckUpdates : DEFAULTS.autoCheckUpdates,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

/** Writes the settings by writing a new file and moving it into place, so a crash cannot leave half a file. */
export function writeDesktopSettings(dataDir: string, settings: DesktopSettings): void {
  const file = settingsPath(dataDir);
  mkdirSync(dirname(file), { recursive: true });
  const part = `${file}.part`;
  writeFileSync(part, `${JSON.stringify(settings, null, 2)}\n`);
  renameSync(part, file);
}
