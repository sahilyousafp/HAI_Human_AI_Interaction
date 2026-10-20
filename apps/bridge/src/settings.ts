import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  GestureBindingsSchema,
  type Message,
  type MessageOf,
  PaletteLayout,
  type Settings,
  SpeechMode,
} from "@aex/protocol";

type Send = (message: Message) => void;

/** The settings file as a plain object; missing or unreadable reads as empty. */
export function readSettingsFile(file: string): Record<string, unknown> {
  try {
    const data = JSON.parse(readFileSync(file, "utf8"));
    return data && typeof data === "object" && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}

/** Merges `patch` into the settings file, keeping keys other parts of the bridge wrote (like lastProject). */
export function updateSettingsFile(file: string, patch: Record<string, unknown>): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ ...readSettingsFile(file), ...patch }, null, 2)}\n`);
}

/**
 * User settings shared by every client: the tool palette layout, what each gesture does and the speech mode. Kept in
 * .aex/settings.json, so they survive reloads, browser changes and restarts. Without a file (tests), settings live in
 * memory.
 */
export class SettingsHub {
  private settings: Settings;

  constructor(
    private readonly file: string | null,
    private readonly broadcast: Send,
  ) {
    const stored = file ? readSettingsFile(file) : {};
    const palette = PaletteLayout.safeParse(stored.palette);
    const gestures = GestureBindingsSchema.safeParse(stored.gestures);
    const speech = SpeechMode.safeParse(stored.speech);
    this.settings = {
      palette: palette.success ? palette.data : null,
      gestures: gestures.success ? gestures.data : null,
      speech: speech.success ? speech.data : "device",
    };
  }

  greet(send: Send): void {
    send(this.snapshot());
  }

  /** Handles a settings message from a client. Returns false for other messages. */
  handle(message: Message): boolean {
    if (message.type !== "settings.set") return false;
    const { palette, gestures, speech } = message.payload;
    const patch: Partial<Settings> = {
      ...(palette ? { palette } : {}),
      ...(gestures ? { gestures } : {}),
      ...(speech ? { speech } : {}),
    };
    this.settings = { ...this.settings, ...patch };
    if (this.file) updateSettingsFile(this.file, patch);
    this.broadcast(this.snapshot());
    return true;
  }

  private snapshot(): MessageOf<"settings.snapshot"> {
    return { type: "settings.snapshot", id: randomUUID(), payload: this.settings };
  }
}
