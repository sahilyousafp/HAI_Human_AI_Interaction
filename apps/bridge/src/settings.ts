import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  FeatureChoices,
  GestureBindingsSchema,
  type Message,
  type MessageOf,
  PaletteLayout,
  ReplyVoice,
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
 * User settings shared by every client: the two palette rings' layouts, what each gesture does, which features
 * are on, whether the user's hands are drawn over the screen, the speech mode, whether the microphone listens for
 * team names and how Mochi's replies are spoken. Kept in .aex/settings.json, so they survive reloads, browser
 * changes and restarts. Without a file (tests), settings live in memory.
 */
export class SettingsHub {
  private settings: Settings;

  constructor(
    private readonly file: string | null,
    private readonly broadcast: Send,
  ) {
    const stored = file ? readSettingsFile(file) : {};
    const palette = PaletteLayout.safeParse(stored.palette);
    const createPalette = PaletteLayout.safeParse(stored.createPalette);
    const gestures = GestureBindingsSchema.safeParse(stored.gestures);
    const speech = SpeechMode.safeParse(stored.speech);
    const replyVoice = ReplyVoice.safeParse(stored.replyVoice);
    const features = FeatureChoices.safeParse(stored.features);
    this.settings = {
      palette: palette.success ? palette.data : null,
      createPalette: createPalette.success ? createPalette.data : null,
      gestures: gestures.success ? gestures.data : null,
      speech: speech.success ? speech.data : "device",
      listenForNames: stored.listenForNames === true,
      speakReplies: stored.speakReplies !== false,
      replyVoice: replyVoice.success ? replyVoice.data : "af_heart",
      features: features.success ? features.data : null,
      showHands: stored.showHands === true,
    };
  }

  greet(send: Send): void {
    send(this.snapshot());
  }

  /** Handles a settings message from a client. Returns false for other messages. */
  handle(message: Message): boolean {
    if (message.type !== "settings.set") return false;
    const {
      palette,
      createPalette,
      gestures,
      speech,
      listenForNames,
      speakReplies,
      replyVoice,
      features,
      showHands,
    } = message.payload;
    const patch: Partial<Settings> = {
      ...(palette ? { palette } : {}),
      ...(createPalette ? { createPalette } : {}),
      ...(gestures ? { gestures } : {}),
      ...(speech ? { speech } : {}),
      ...(listenForNames !== undefined ? { listenForNames } : {}),
      ...(speakReplies !== undefined ? { speakReplies } : {}),
      ...(replyVoice ? { replyVoice } : {}),
      // Feature choices merge, so switching one feature never resets the others.
      ...(features ? { features: { ...this.settings.features, ...features } } : {}),
      ...(showHands !== undefined ? { showHands } : {}),
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
