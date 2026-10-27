import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  DominantHand,
  DrawingAidChoices,
  FeatureChoices,
  type FeatureId,
  GestureBindingsSchema,
  type Message,
  type MessageOf,
  ModellingMode,
  migrateRingSettings,
  OPEN_DATA_SOURCE_IDS,
  OPEN_DATA_SOURCES,
  PaletteLayout,
  PortalHost,
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

/** The source choices as stored: only known sources with a yes or no. */
function parseSourceChoices(stored: unknown): Record<string, boolean> {
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return {};
  return Object.fromEntries(
    Object.entries(stored).filter(
      (entry): entry is [string, boolean] =>
        OPEN_DATA_SOURCE_IDS.includes(entry[0]) && typeof entry[1] === "boolean",
    ),
  );
}

/** A list of known source ids, or of valid portal hosts, as stored; anything else is dropped. */
function parseList(stored: unknown, valid: (item: string) => boolean): string[] {
  if (!Array.isArray(stored)) return [];
  return [...new Set(stored.filter((item): item is string => typeof item === "string" && valid(item)))];
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
    const stored = file ? SettingsHub.migrated(file) : {};
    const palette = PaletteLayout.safeParse(stored.palette);
    const createPalette = PaletteLayout.safeParse(stored.createPalette);
    const dominantHand = DominantHand.safeParse(stored.dominantHand);
    const gestures = GestureBindingsSchema.safeParse(stored.gestures);
    const speech = SpeechMode.safeParse(stored.speech);
    const replyVoice = ReplyVoice.safeParse(stored.replyVoice);
    const features = FeatureChoices.safeParse(stored.features);
    const drawingAids = DrawingAidChoices.safeParse(stored.drawingAids);
    const modelling = ModellingMode.safeParse(stored.modelling);
    this.settings = {
      palette: palette.success ? palette.data : null,
      createPalette: createPalette.success ? createPalette.data : null,
      dominantHand: dominantHand.success ? dominantHand.data : "Right",
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
      showContext: stored.showContext !== false,
      openDataSources: parseSourceChoices(stored.openDataSources),
      openDataAcknowledged: parseList(stored.openDataAcknowledged, (id) => OPEN_DATA_SOURCE_IDS.includes(id)),
      portalHosts: parseList(stored.portalHosts, (host) => PortalHost.safeParse(host).success),
    };
  }

  /**
   * The settings file brought up to date (old default rings and long pinch take the new defaults), written back when
   * that changed anything, so the file says what the app does.
   */
  private static migrated(file: string): Record<string, unknown> {
    const stored = readSettingsFile(file);
    const migrated = migrateRingSettings(stored);
    if (JSON.stringify(migrated) !== JSON.stringify(stored)) updateSettingsFile(file, migrated);
    return migrated;
  }

  /**
   * Whether open data from this source may be fetched now: the Open data switch is on, the source is not switched
   * off, and a source with a limit (a free service for non-commercial use) has been acknowledged.
   */
  openDataAllows(sourceId: string): boolean {
    if (!this.featureOn("openData")) return false;
    const source = OPEN_DATA_SOURCES.find((s) => s.id === sourceId);
    if (!source || this.settings.openDataSources[sourceId] === false) return false;
    return !source.limit || this.settings.openDataAcknowledged.includes(sourceId);
  }

  /** The portal hosts the user added (the starter list is the app's own). */
  get portalHosts(): readonly string[] {
    return this.settings.portalHosts;
  }

  /** Whether the user wants the city context drawn (agents' own pictures include it either way). */
  get showContext(): boolean {
    return this.settings.showContext;
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
      dominantHand,
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
      showContext,
      openDataSources,
      openDataAcknowledged,
      portalHosts,
    } = message.payload;
    const patch: Partial<Settings> = {
      ...(palette ? { palette } : {}),
      ...(createPalette ? { createPalette } : {}),
      ...(dominantHand ? { dominantHand } : {}),
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
      ...(showContext !== undefined ? { showContext } : {}),
      // Source choices merge, so switching one source never resets the others.
      ...(openDataSources
        ? { openDataSources: { ...this.settings.openDataSources, ...parseSourceChoices(openDataSources) } }
        : {}),
      ...(openDataAcknowledged
        ? {
            openDataAcknowledged: [
              ...new Set([...this.settings.openDataAcknowledged, ...openDataAcknowledged]),
            ],
          }
        : {}),
      ...(portalHosts ? { portalHosts: [...new Set(portalHosts)] } : {}),
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
