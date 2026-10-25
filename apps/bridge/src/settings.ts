import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  DrawingAidChoices,
  FeatureChoices,
  type FeatureId,
  GestureBindingsSchema,
  type Message,
  type MessageOf,
  ModellingMode,
  PaletteLayout,
  ReplyVoice,
  resolveFeatures,
  type Settings,
  SpeechMode,
} from "@hai/protocol";

type Send = (message: Message) => void;

/** The session limit as stored: a whole number from 2 to 12, else the default of 6. */
function parseSessions(stored: unknown): number {
  return typeof stored === "number" && Number.isInteger(stored) && stored >= 2 && stored <= 12 ? stored : 6;
}

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
 * are on, which drawing aids are on, whether the user's hands are drawn over the screen, the speech mode, whether the microphone listens for
 * team names and how Mochi's replies are spoken. Kept in .hai/settings.json, so they survive reloads, browser
 * changes and restarts. Without a file (tests), settings live in memory.
 */
export class SettingsHub {
  private settings: Settings;

  constructor(
    private readonly file: string | null,
    private readonly broadcast: Send,
    /** A feature the user switched on or off (called once per switch). */
    private readonly featureChanged: (feature: FeatureId, on: boolean) => void = () => {},
  ) {
    const stored = file ? readSettingsFile(file) : {};
    const palette = PaletteLayout.safeParse(stored.palette);
    const createPalette = PaletteLayout.safeParse(stored.createPalette);
    const gestures = GestureBindingsSchema.safeParse(stored.gestures);
    const speech = SpeechMode.safeParse(stored.speech);
    const replyVoice = ReplyVoice.safeParse(stored.replyVoice);
    const features = FeatureChoices.safeParse(stored.features);
    const drawingAids = DrawingAidChoices.safeParse(stored.drawingAids);
    const modelling = ModellingMode.safeParse(stored.modelling);
    this.settings = {
      palette: palette.success ? palette.data : null,
      createPalette: createPalette.success ? createPalette.data : null,
      gestures: gestures.success ? gestures.data : null,
      speech: speech.success ? speech.data : "device",
      listenForNames: stored.listenForNames === true,
      speakReplies: stored.speakReplies !== false,
      replyVoice: replyVoice.success ? replyVoice.data : "af_heart",
      features: features.success ? features.data : null,
      drawingAids: drawingAids.success ? drawingAids.data : null,
      showHands: stored.showHands === true,
      modelling: modelling.success ? modelling.data : "auto",
      showOwners: stored.showOwners !== false,
      showCameras: stored.showCameras !== false,
      maxSessions: parseSessions(stored.maxSessions),
    };
  }

  greet(send: Send): void {
    send(this.snapshot());
  }

  /** How the user chose the agent to model (Settings > Modelling). */
  /** How many agent sessions (Mochi, specialists, workers) may run at once. */
  get maxSessions(): number {
    return this.settings.maxSessions;
  }

  get modelling(): ModellingMode {
    return this.settings.modelling;
  }

  /** Whether a feature is on (every feature is until the user switches it off). */
  featureOn(id: FeatureId): boolean {
    return resolveFeatures(this.settings.features)[id];
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
      drawingAids,
      showHands,
      modelling,
      showOwners,
      showCameras,
      maxSessions,
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
      // Drawing aids merge the same way.
      ...(drawingAids ? { drawingAids: { ...this.settings.drawingAids, ...drawingAids } } : {}),
      ...(showHands !== undefined ? { showHands } : {}),
      ...(modelling ? { modelling } : {}),
      ...(showOwners !== undefined ? { showOwners } : {}),
      ...(showCameras !== undefined ? { showCameras } : {}),
      ...(maxSessions !== undefined ? { maxSessions } : {}),
    };
    const before = resolveFeatures(this.settings.features);
    this.settings = { ...this.settings, ...patch };
    if (this.file) updateSettingsFile(this.file, patch);
    this.broadcast(this.snapshot());
    const after = resolveFeatures(this.settings.features);
    for (const id of Object.keys(after) as FeatureId[])
      if (before[id] !== after[id]) this.featureChanged(id, after[id]);
    return true;
  }

  private snapshot(): MessageOf<"settings.snapshot"> {
    return { type: "settings.snapshot", id: randomUUID(), payload: this.settings };
  }
}
