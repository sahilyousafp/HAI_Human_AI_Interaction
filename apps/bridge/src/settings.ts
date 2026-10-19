import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { type Message, type MessageOf, PaletteLayout } from "@aex/protocol";

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
 * User settings shared by every client: today the tool palette layout. Kept in .aex/settings.json, so the layout
 * survives reloads, browser changes and restarts. Without a file (tests), settings live in memory.
 */
export class SettingsHub {
  private palette: PaletteLayout | null;

  constructor(
    private readonly file: string | null,
    private readonly broadcast: Send,
  ) {
    const stored = file ? PaletteLayout.safeParse(readSettingsFile(file).palette) : null;
    this.palette = stored?.success ? stored.data : null;
  }

  greet(send: Send): void {
    send(this.snapshot());
  }

  /** Handles a settings message from a client. Returns false for other messages. */
  handle(message: Message): boolean {
    if (message.type !== "settings.set") return false;
    this.palette = message.payload.palette;
    if (this.file) updateSettingsFile(this.file, { palette: this.palette });
    this.broadcast(this.snapshot());
    return true;
  }

  private snapshot(): MessageOf<"settings.snapshot"> {
    return { type: "settings.snapshot", id: randomUUID(), payload: { palette: this.palette } };
  }
}
