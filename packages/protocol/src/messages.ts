import { z } from "zod";
import {
  AgentDefinition,
  AgentDefinitionInput,
  AgentEvent,
  AgentStatus,
  AgentTurn,
  ApprovalOutcome,
  ApprovalRequest,
  ExtensionName,
  ExtensionsState,
  McpServerSpec,
  PlanOutcome,
  PlanPart,
  RequestContext,
  TaskScope,
  TeamClaim,
  TeamMemberInfo,
  TeamTask,
} from "./agent.ts";
import { GestureBindingsSchema } from "./bindings.ts";
import { ContextCredit, ContextItem } from "./context.ts";
import { DrawingAidChoices } from "./drawing-aids.ts";
import { BridgeStatusMessage, Envelope, HelloMessage, MessageId } from "./envelope.ts";
import { FeatureChoices } from "./features.ts";
import { OPEN_DATA_SOURCE_IDS, OpenDataRecordEntry, PortalHost, Site } from "./open-data.ts";
import { PanelDocument, PanelId, PanelOfferState, PanelOutcome } from "./panel.ts";
import { LetterMarkers } from "./references.ts";
import {
  ModellingInUse,
  ModellingMode,
  RHINO_PYTHON_MAX_CODE,
  RhinoBatch,
  RhinoNotDrawn,
  RhinoObject,
  RhinoPythonResult,
  RhinoPythonStatus,
  RhinoSelected,
  RhinoSync,
  ViewRequest,
} from "./rhino.ts";
import { DominantHand } from "./rings.ts";
import { ElementId, SceneDocument, SceneOp } from "./scene.ts";

function message<T extends string, P extends z.ZodType>(type: T, payload: P) {
  return z.strictObject({ type: z.literal(type), id: MessageId, payload });
}

const UndoState = { canUndo: z.boolean(), canRedo: z.boolean() };

/** Tool id per palette slot, clockwise from the top; null is an empty slot. */
export const PaletteLayout = z.array(z.string().min(1).max(64).nullable()).length(8);
export type PaletteLayout = z.infer<typeof PaletteLayout>;

export const SpeechMode = z.enum(["device", "cloud"]);
export type SpeechMode = z.infer<typeof SpeechMode>;
/** Mochi's voice for spoken replies (Kokoro voices fetched by pnpm assets). */
export const ReplyVoice = z.enum(["af_heart", "am_michael"]);
export type ReplyVoice = z.infer<typeof ReplyVoice>;

/** What the collapsed chat rail can show; the order of the ones chosen is their priority, top to bottom. */
export const STRIP_ITEMS = ["waiting", "state", "team", "name", "lastLine", "mic"] as const;
export const StripItem = z.enum(STRIP_ITEMS);
export type StripItem = z.infer<typeof StripItem>;

/** The ready-made choices of the collapsed rail. */
export const STRIP_PRESETS = {
  /** The chevron, the state, the name, what waits for the user, and the microphone. */
  quiet: ["state", "name", "waiting", "mic"],
  /** What waits for the user takes the strip over; otherwise just the state and the microphone. */
  "needs-you": ["waiting", "state", "mic"],
  /** One dot per agent, then what waits for the user, and the microphone. */
  team: ["team", "waiting", "mic"],
} as const satisfies Record<string, readonly StripItem[]>;

/** The collapsed rail: a preset, or the user's own list (`custom`). `items` is what is shown, in priority order. */
export const StripLayout = z.strictObject({
  preset: z.enum(["quiet", "needs-you", "team", "custom"]),
  items: z
    .array(StripItem)
    .max(STRIP_ITEMS.length)
    .refine((items) => new Set(items).size === items.length, "an item is listed twice"),
});
export type StripLayout = z.infer<typeof StripLayout>;

export const DEFAULT_STRIP: StripLayout = { preset: "needs-you", items: [...STRIP_PRESETS["needs-you"]] };

/** User settings kept by the bridge in .hai/settings.json. */
export const Settings = z.strictObject({
  /** The action ring (the dominant hand's); null until the user changes it: the app's default applies. */
  palette: PaletteLayout.nullable(),
  /** The reference ring (the other hand's); null until the user changes it. */
  createPalette: PaletteLayout.nullable().default(null),
  /** The hand the user draws with: its silent long pinch shows the action ring, the other hand's the reference ring. */
  dominantHand: DominantHand.default("Right"),
  /** What each gesture does, where the user changed it; the rest keep their defaults. */
  gestures: GestureBindingsSchema.nullable().default(null),
  /** Where speech is turned into text: on this laptop (default), or the browser's cloud service (opt-in). */
  speech: SpeechMode.default("device"),
  /** Keep the microphone open and turn only utterances that start with a team name into requests (opt-in). */
  listenForNames: z.boolean().default(false),
  /** Whether Mochi's replies are spoken (on by default; muting is remembered). */
  speakReplies: z.boolean().default(true),
  replyVoice: ReplyVoice.default("af_heart"),
  /** What the chat rail shows when it is collapsed, and in what order of priority. */
  railStrip: StripLayout.default(DEFAULT_STRIP),
  /** Features the user switched on or off; the rest are on. */
  features: FeatureChoices.nullable().default(null),
  /** Drawing aids the user switched on or off; the rest keep their defaults (only Grid is on). */
  drawingAids: DrawingAidChoices.nullable().default(null),
  /** Draw the user's hands as white shapes over the whole screen, so people watching a recording can follow. */
  showHands: z.boolean().default(false),
  /** How the agent models: with Rhino when it is connected (default), always with Rhino, or only with Python. */
  modelling: ModellingMode.default("auto"),
  /** Tint and outline the elements agents own in their colour, and draw region claims (the panel lists claims anyway). */
  showOwners: z.boolean().default(true),
  /** Draw a small marker for each camera an agent placed (the panel shows its pictures either way). */
  showCameras: z.boolean().default(true),
  /** How many agent sessions may run at once: Mochi, the specialists and their workers. Each is a model session with its own cost. */
  maxSessions: z.number().int().min(2).max(12).default(6),
  /** Show the city context agents fetched (buildings, trees, ground data); agents' own pictures always include it. */
  showContext: z.boolean().default(true),
  /** Per-source choices for open data, where the user changed them; a source is on until switched off. */
  openDataSources: z.record(z.string(), z.boolean()).default({}),
  /** Sources whose limit the user acknowledged (a free service for non-commercial use only). */
  openDataAcknowledged: z.array(z.string()).default([]),
  /** Portal hosts the user added to the starter list. */
  portalHosts: z.array(PortalHost).max(50).default([]),
});
export type Settings = z.infer<typeof Settings>;
const Project = z.strictObject({ name: z.string(), path: z.string() });

// Bridge -> clients
export const SceneSnapshotMessage = message(
  "scene.snapshot",
  z.strictObject({
    seq: z.int().nonnegative(),
    doc: SceneDocument,
    selection: z.array(ElementId),
    project: Project.nullable(),
    ...UndoState,
  }),
);
export const ScenePatchMessage = message(
  "scene.patch",
  z.strictObject({
    seq: z.int().positive(),
    kind: z.enum(["apply", "undo", "redo"]),
    label: z.string(),
    /** Who made the change: "user", or the name of the agent. */
    by: z.string().min(1).default("user"),
    ops: z.array(SceneOp),
    ...UndoState,
  }),
);
export const SelectionChangedMessage = message(
  "selection.changed",
  z.strictObject({ ids: z.array(ElementId) }),
);
export const ProjectStatusMessage = message(
  "project.status",
  z.strictObject({
    project: Project.nullable(),
    savedAt: z.iso.datetime().nullable(),
    error: z.string().nullable(),
  }),
);
/** The current settings: sent on connect and to every client after a change. */
export const SettingsSnapshotMessage = message("settings.snapshot", Settings);
/** Reply to a client request that could not be applied (for example an invalid transaction). */
export const RequestErrorMessage = message(
  "request.error",
  z.strictObject({ requestId: MessageId, message: z.string() }),
);

/** What the user is looking at: the element under the hand pointer and the camera (for the agent's context). */
export const ViewCamera = z.strictObject({
  azimuth: z.number(),
  elevation: z.number(),
  distance: z.number(),
  target: z.tuple([z.number(), z.number(), z.number()]),
});
export type ViewCamera = z.infer<typeof ViewCamera>;

/** A camera an agent placed for itself: named, and private to that agent. Same units as `ViewCamera`. */
export const AgentCamera = z.strictObject({
  name: z.string().min(1).max(32),
  azimuth: z.number(),
  elevation: z.number(),
  distance: z.number().positive(),
  target: z.tuple([z.number(), z.number(), z.number()]),
});
export type AgentCamera = z.infer<typeof AgentCamera>;
/** At most this many cameras per agent, and per picture request. */
export const MAX_AGENT_CAMERAS = 8;

/** What a picture from an agent camera may show of the user's own state; both are off unless asked for. */
export const ShotOptions = z.strictObject({
  /** The section cut the user has set. */
  section: z.boolean().default(false),
  /** The selection, hover and deletion marks. */
  selection: z.boolean().default(false),
});
export type ShotOptions = z.infer<typeof ShotOptions>;

/** The last picture an agent took, as the strip shows it. */
export const TeamShot = z.strictObject({
  agent: z.string().min(1).max(64),
  camera: z.string().min(1).max(32),
  at: z.number(),
  /** A small JPEG as a data URL. */
  thumb: z.string().max(60_000),
});
export type TeamShot = z.infer<typeof TeamShot>;
/** One agent camera, for the markers in the model. */
export const TeamCamera = AgentCamera.extend({ agent: z.string().min(1).max(64) });
export type TeamCamera = z.infer<typeof TeamCamera>;

// Agent session, bridge -> clients
/** Which agent of the team a message is about; without it, the single session of a bridge without a team. */
const AgentName = z.string().min(1).max(64).optional();
export const AgentStatusMessage = message(
  "agent.status",
  z.strictObject({ status: AgentStatus, agent: AgentName }),
);
/** Everything so far in this session: sent on connect, so a reloaded page shows the whole conversation. */
export const AgentTranscriptMessage = message(
  "agent.transcript",
  z.strictObject({
    turns: z.array(AgentTurn),
    status: AgentStatus,
    pending: z.array(ApprovalRequest),
    agent: AgentName,
  }),
);
export const AgentTurnStartMessage = message(
  "agent.turn",
  z.strictObject({
    id: z.string(),
    request: z.string(),
    context: RequestContext.optional(),
    recovered: z.boolean(),
    kind: AgentTurn.shape.kind,
    taskId: z.string().optional(),
    agent: AgentName,
  }),
);
export const AgentEventMessage = message(
  "agent.event",
  z.strictObject({ turnId: z.string(), event: AgentEvent, agent: AgentName }),
);
/** The team and its task board: sent on connect and whenever a task or the roster changes. */
export const TeamSnapshotMessage = message(
  "team.snapshot",
  z.strictObject({
    members: z.array(TeamMemberInfo),
    tasks: z.array(TeamTask),
    /** What the running writing tasks hold. */
    claims: z.array(TeamClaim).default([]),
    /** How many specialists may run at once. */
    maxRunning: z.number().int().min(1),
    /** How many sessions (Mochi, specialists, workers) may run at once, and how many do. */
    maxSessions: z.number().int().min(1).default(6),
    sessions: z.number().int().min(0).default(0),
    /** The last picture each agent took from one of its cameras. */
    shots: z.array(TeamShot).default([]),
    /** The cameras agents have placed. */
    cameras: z.array(TeamCamera).default([]),
  }),
);
/** The project's agent definitions (Agents tab); `saved` names the agent just saved. */
export const AgentsSnapshotMessage = message(
  "agents.snapshot",
  z.strictObject({ definitions: z.array(AgentDefinition), saved: z.string().optional() }),
);
export const ApprovalPendingMessage = message("approval.pending", ApprovalRequest);
/** Mochi shows the user how it means to split a request, before it hands any part out. */
export const PlanPendingMessage = message(
  "plan.pending",
  z.strictObject({
    id: z.string(),
    parts: z.array(PlanPart).min(1).max(12),
    agent: z.string().optional(),
    expiresAt: z.number(),
  }),
);
/** How a plan ended, with the ids of the parts the user kept. */
export const PlanResolvedMessage = message(
  "plan.resolved",
  z.strictObject({ id: z.string(), outcome: PlanOutcome, keep: z.array(z.string()) }),
);
/** A sun position for the viewer's light (a sun study), in degrees; azimuth clockwise from north (+Y). */
export const SunSetting = z.strictObject({
  altitude: z.number().min(-90).max(90),
  azimuth: z.number().min(0).max(360),
  /** What the study shows, e.g. "21 Dec 12:00, 51.5 N 0 E". */
  label: z.string().max(120),
});
export type SunSetting = z.infer<typeof SunSetting>;
/** The agent asked to see the view: a viewer answers with a PNG, after setting the sun when one is given. */
export const ViewCaptureMessage = message(
  "view.capture",
  z.strictObject({
    requestId: z.string(),
    sun: SunSetting.optional(),
    /** The agent asking. With `cameras`, the pictures are taken off-screen from them; without, from the user's view. */
    agent: z.string().min(1).max(64).optional(),
    cameras: z.array(AgentCamera).min(1).max(MAX_AGENT_CAMERAS).optional(),
    /** The longest side of each picture in pixels (at most 1280). */
    size: z.number().int().min(64).max(1280).optional(),
    options: ShotOptions.optional(),
  }),
);
export const ApprovalResolvedMessage = message(
  "approval.resolved",
  z.strictObject({ id: z.string(), outcome: ApprovalOutcome }),
);
/** The agent's extensions; `notice` reports the change just applied ("active from your next request"). */
export const ExtensionsSnapshotMessage = message(
  "extensions.snapshot",
  ExtensionsState.extend({ notice: z.string().optional() }),
);
/** The tools the user chose "Always allow" for in the open project. */
export const ApprovalsAllowedMessage = message(
  "approvals.allowed",
  z.strictObject({ tools: z.array(z.string()) }),
);

/**
 * A panel offer: the agent asks whether the user wants a panel for a task. Sent when it is made and again for each
 * change of state, so every client shows the same card.
 */
export const PanelOfferMessage = message(
  "panel.offer",
  z.strictObject({
    offerId: PanelId,
    purpose: z.string().trim().min(1).max(200),
    state: PanelOfferState,
    agent: AgentName,
  }),
);
/** The agent supplied the panel (the first document after an accepted offer). */
export const PanelOpenMessage = message(
  "panel.open",
  PanelDocument.extend({
    panelId: PanelId,
    offerId: PanelId,
    agent: AgentName,
    /** Set by the bridge for an agent that does not change the model: the panel shows and cannot change anything. */
    readOnly: z.boolean().optional(),
  }),
);
/** The agent replaced the open panel's document; any uncommitted preview is discarded. */
export const PanelUpdateMessage = message(
  "panel.update",
  PanelDocument.extend({ panelId: PanelId, readOnly: z.boolean().optional() }),
);
/** The bridge closes the panel: the agent asked, or the Generated panels feature was switched off. */
export const PanelCloseMessage = message(
  "panel.close",
  z.strictObject({ panelId: PanelId, reason: z.enum(["agent", "switched-off"]) }),
);

/**
 * Everything the viewer needs to know about Rhino: whether it is connected, how the agent models now, and the
 * mirrored objects. Sent on connect and whenever the connection, the mode or the document is replaced; changes in
 * between arrive as `rhino.objects` and `rhino.selection`.
 */
export const RhinoStateMessage = message(
  "rhino.state",
  z.strictObject({
    connected: z.boolean(),
    mode: ModellingMode,
    inUse: ModellingInUse,
    python: RhinoPythonStatus.nullable(),
    document: z.string().nullable(),
    objects: z.array(RhinoObject),
    notDrawn: RhinoNotDrawn,
    sync: RhinoSync.nullable(),
    selection: z.array(z.string()),
  }),
);
/** A Python run left these `.3dm` files in the project: the HUD offers to import them or open them in Rhino. */
const WrittenFile = z.strictObject({
  path: z.string().min(1).max(520),
  size: z.number().int().nonnegative(),
});
export const PythonWrittenMessage = message(
  "python.written",
  z
    .strictObject({
      /** The files the run declared and wrote: these are offered. */
      files: z.array(WrittenFile).max(50),
      /** `.3dm` files that changed during the run without being declared: reported, not offered. */
      outside: z.array(WrittenFile).max(50).optional(),
      /** The kept script that wrote them, relative to the project. */
      script: z.string().max(520),
      agent: z.string().max(64).optional(),
    })
    .refine((p) => p.files.length > 0 || (p.outside?.length ?? 0) > 0, "no files"),
);
/** The agent asked for a different view; the viewer animates to it. */
export const ViewSetMessage = message("view.set", ViewRequest);
/** Bridge -> Rhino: run a Python script in the open document. */
export const RhinoPythonRunMessage = message(
  "rhino.python.run",
  z.strictObject({
    id: z.string().min(1).max(64),
    code: z.string().min(1).max(RHINO_PYTHON_MAX_CODE),
    timeoutMs: z.int().positive().max(600_000),
    /** The agent that asked and the run's title, kept with the undo step. */
    agent: z.string().max(64).optional(),
    title: z.string().max(80).optional(),
    /** The part the agent's task works on: objects the run adds are stamped `hai.part` with it. */
    part: z.string().max(64).optional(),
    /** The part of the model the agent's task may change; absent means all of it. */
    claim: TaskScope.optional(),
  }),
);
/** Bridge -> Rhino: undo the last Python run (it is one undo step). */
export const RhinoUndoMessage = message("rhino.undo", z.strictObject({}));
/** What a Rhino script did outside its claim, found after the run: for the user's panel, with the way to undo it. */
export const RhinoRunReportMessage = message(
  "rhino.run.report",
  z.strictObject({
    agent: z.string().max(64).nullable(),
    title: z.string().max(80),
    strays: z
      .array(
        z.strictObject({
          id: ElementId,
          name: z.string().max(200),
          what: z.enum(["added", "changed", "deleted"]),
          /** Whose claim it is in, when someone's. */
          holder: z.string().max(200).optional(),
        }),
      )
      .min(1)
      .max(100),
    /** More strays than are listed. */
    truncated: z.boolean(),
  }),
);

// Rhino plugin -> bridge (the bridge relays objects and selection to the viewers)
/** The Python status or the document changed. */
export const RhinoStatusMessage = message(
  "rhino.status",
  z.strictObject({ python: RhinoPythonStatus, document: z.string().max(260).nullable() }),
);
/** What changed in the document: objects added or replaced (with their meshes already uploaded), and objects deleted. */
export const RhinoObjectsMessage = message("rhino.objects", RhinoBatch);
/** The selection in Rhino changed. */
export const RhinoSelectionMessage = message(
  "rhino.selection",
  z.strictObject({ objects: z.array(RhinoSelected).max(2000) }),
);
export const RhinoPythonResultMessage = message("rhino.python.result", RhinoPythonResult);

// Clients -> bridge
/**
 * Open a project file in Rhino. From a page the path is relative to the project folder; the bridge checks it and sends
 * the plugin the absolute path.
 */
export const RhinoOpenMessage = message("rhino.open", z.strictObject({ path: z.string().min(1).max(1024) }));
/** Select these Rhino objects (a pick in the viewer); the bridge passes it on to the plugin. Empty clears. */
export const RhinoSelectMessage = message(
  "rhino.select",
  z.strictObject({ ids: z.array(ElementId).max(500) }),
);
export const SceneApplyMessage = message(
  "scene.apply",
  z.strictObject({ label: z.string().min(1).max(120), ops: z.array(SceneOp).min(1) }),
);
export const SceneUndoMessage = message("scene.undo", z.strictObject({}));
export const SceneRedoMessage = message("scene.redo", z.strictObject({}));
/** Sent by a client that noticed a gap in patch sequence numbers; the bridge replies with a snapshot. */
export const SceneResyncMessage = message("scene.resync", z.strictObject({}));
export const SelectionSetMessage = message("selection.set", z.strictObject({ ids: z.array(ElementId) }));
export const ProjectOpenMessage = message("project.open", z.strictObject({ path: z.string().min(1) }));
/** Starts a new, empty project in a folder that does not hold one yet, and opens it. */
export const ProjectCreateMessage = message("project.create", z.strictObject({ path: z.string().min(1) }));
/** Changes one or more settings; what is left out keeps its value. */
export const SettingsSetMessage = message(
  "settings.set",
  z.strictObject({
    palette: PaletteLayout.optional(),
    createPalette: PaletteLayout.optional(),
    dominantHand: DominantHand.optional(),
    gestures: GestureBindingsSchema.optional(),
    speech: SpeechMode.optional(),
    listenForNames: z.boolean().optional(),
    speakReplies: z.boolean().optional(),
    replyVoice: ReplyVoice.optional(),
    railStrip: StripLayout.optional(),
    features: FeatureChoices.optional(),
    drawingAids: DrawingAidChoices.optional(),
    showHands: z.boolean().optional(),
    modelling: ModellingMode.optional(),
    showOwners: z.boolean().optional(),
    showCameras: z.boolean().optional(),
    maxSessions: z.number().int().min(2).max(12).optional(),
    showContext: z.boolean().optional(),
    /** Sources switched on or off; merged into the saved choices. */
    openDataSources: z
      .partialRecord(z.enum(OPEN_DATA_SOURCE_IDS as [string, ...string[]]), z.boolean())
      .optional(),
    openDataAcknowledged: z.array(z.enum(OPEN_DATA_SOURCE_IDS as [string, ...string[]])).optional(),
    portalHosts: z.array(PortalHost).max(50).optional(),
  }),
);
/** The project's site, or null when it has none (sent on connect, project change and every change). */
export const SiteSnapshotMessage = message("site.snapshot", z.strictObject({ site: Site.nullable() }));
/** The open project's lettered markers (Place marker), sent on connect and whenever they change. */
export const MarkersSnapshotMessage = message("markers.snapshot", z.strictObject({ markers: LetterMarkers }));
/** The user placed or removed a marker: the project's whole list as it is now. */
export const MarkersSetMessage = message("markers.set", z.strictObject({ markers: LetterMarkers }));
/** The user sets, changes or clears the project's site in Settings. */
export const SiteSetMessage = message("site.set", z.strictObject({ site: Site.nullable() }));
/** The open-data requests made in this session, newest last (sent on connect and after every request). */
export const OpenDataRecordMessage = message(
  "opendata.record",
  z.strictObject({ entries: z.array(OpenDataRecordEntry).max(200) }),
);
/**
 * The city context agents fetched (buildings, trees, ground data), drawn read-only beside the model. It is not part of
 * the scene document. `stale` is set when the site changed after it was built.
 */
export const ContextSnapshotMessage = message(
  "context.snapshot",
  z.strictObject({
    items: z.array(ContextItem).max(10_000),
    stale: z.boolean(),
    credits: z.array(ContextCredit),
  }),
);
/** The user clears the list of requests (the cache stays). */
export const OpenDataClearMessage = message("opendata.clear", z.strictObject({}));
/** The user empties the city context layer in Settings (agents can fetch it again). */
export const ContextClearMessage = message("context.clear", z.strictObject({}));
export const AgentSendMessage = message(
  "agent.send",
  z.strictObject({
    text: z.string().min(1).max(8000),
    context: RequestContext.optional(),
    /** The specialist the user named ("Architect, ..."): Mochi hands the request to it. */
    agent: AgentName,
  }),
);
export const ContextUpdateMessage = message(
  "context.update",
  z.strictObject({ pointed: ElementId.nullable(), camera: ViewCamera.nullable() }),
);
export const ViewCapturedMessage = message(
  "view.captured",
  z.strictObject({
    requestId: z.string(),
    /** Base64 PNG, longest side at most 1280 px. */
    png: z.string().max(12_000_000).optional(),
    /** The pictures of a request with cameras, in the order asked, each with a small thumbnail (a JPEG data URL). */
    shots: z
      .array(
        z.strictObject({ camera: z.string(), png: z.string().max(6_000_000), thumb: z.string().max(60_000) }),
      )
      .max(MAX_AGENT_CAMERAS)
      .optional(),
    error: z.string().optional(),
  }),
);
/** Stops everything the team is doing (Mochi's turn and every task). */
export const AgentStopMessage = message("agent.stop", z.strictObject({}));
/** Stops one request the user just sent (a shake right after a held request): its turn and the tasks it handed out. */
export const AgentStopRequestMessage = message(
  "agent.stopRequest",
  z.strictObject({ requestId: z.string() }),
);
/** Adds or changes an agent of the open project's team. */
export const AgentsSaveMessage = message("agents.save", z.strictObject({ agent: AgentDefinitionInput }));
/** Stops one task, or takes it off the queue. */
export const TaskStopMessage = message("task.stop", z.strictObject({ id: z.string() }));
/** The user's answer to a plan: the parts to keep, or null to skip the plan. */
export const PlanAnswerMessage = message(
  "plan.answer",
  z.strictObject({ id: z.string(), keep: z.array(z.string()).nullable() }),
);
export const ApprovalDecideMessage = message(
  "approval.decide",
  z.strictObject({ id: z.string(), decision: z.enum(["allow", "deny", "always"]) }),
);
export const ExtensionsAddServerMessage = message(
  "extensions.addServer",
  z.strictObject({ server: McpServerSpec }),
);
export const ExtensionsRemoveServerMessage = message(
  "extensions.removeServer",
  z.strictObject({ name: ExtensionName }),
);
/** Installs a skill from a local folder or an https git repository URL. */
export const ExtensionsInstallSkillMessage = message(
  "extensions.installSkill",
  z.strictObject({ source: z.string().min(1).max(2000) }),
);
export const ExtensionsRemoveSkillMessage = message(
  "extensions.removeSkill",
  z.strictObject({ name: ExtensionName }),
);
/** Removes a tool from the open project's "Always allow" list: it asks again next time. */
export const ApprovalsRevokeMessage = message("approvals.revoke", z.strictObject({ tool: z.string() }));
/** The user's answer to a panel offer (Open or nod, Skip or shake). */
export const PanelOfferAnswerMessage = message(
  "panel.offer.answer",
  z.strictObject({ offerId: PanelId, answer: z.enum(["accepted", "skipped"]) }),
);
/** Whether the panel's document loaded: the agent's open_panel call waits for this. */
export const PanelStatusMessage = message(
  "panel.status",
  z.strictObject({
    panelId: PanelId,
    state: z.enum(["ready", "failed"]),
    reason: z.string().max(2000).optional(),
  }),
);
/** An information panel tried to preview or commit a change and was refused; the agent is told when it closes. */
export const PanelRefusedMessage = message(
  "panel.refused",
  z.strictObject({ panelId: PanelId, attempt: z.enum(["preview", "commit"]) }),
);
/** The panel closed, and whether its result was kept (Done) or discarded. */
export const PanelClosedMessage = message(
  "panel.closed",
  z.strictObject({ panelId: PanelId, outcome: PanelOutcome }),
);

export const Message = z.discriminatedUnion("type", [
  HelloMessage,
  BridgeStatusMessage,
  SceneSnapshotMessage,
  ScenePatchMessage,
  SelectionChangedMessage,
  ProjectStatusMessage,
  RequestErrorMessage,
  SettingsSnapshotMessage,
  SiteSnapshotMessage,
  SiteSetMessage,
  MarkersSnapshotMessage,
  MarkersSetMessage,
  ContextSnapshotMessage,
  OpenDataRecordMessage,
  OpenDataClearMessage,
  ContextClearMessage,
  AgentStatusMessage,
  AgentTranscriptMessage,
  AgentTurnStartMessage,
  AgentEventMessage,
  TeamSnapshotMessage,
  AgentsSnapshotMessage,
  ApprovalPendingMessage,
  PlanPendingMessage,
  PlanResolvedMessage,
  ApprovalResolvedMessage,
  ApprovalsAllowedMessage,
  ExtensionsSnapshotMessage,
  RhinoStateMessage,
  ViewSetMessage,
  RhinoPythonRunMessage,
  RhinoUndoMessage,
  RhinoRunReportMessage,
  RhinoStatusMessage,
  RhinoObjectsMessage,
  RhinoSelectionMessage,
  RhinoPythonResultMessage,
  RhinoSelectMessage,
  RhinoOpenMessage,
  PythonWrittenMessage,
  PanelOfferMessage,
  PanelOpenMessage,
  PanelUpdateMessage,
  PanelCloseMessage,
  ViewCaptureMessage,
  SceneApplyMessage,
  SceneUndoMessage,
  SceneRedoMessage,
  SceneResyncMessage,
  SelectionSetMessage,
  ProjectOpenMessage,
  ProjectCreateMessage,
  SettingsSetMessage,
  AgentSendMessage,
  AgentStopMessage,
  AgentStopRequestMessage,
  TaskStopMessage,
  AgentsSaveMessage,
  ApprovalDecideMessage,
  PlanAnswerMessage,
  ApprovalsRevokeMessage,
  ExtensionsAddServerMessage,
  ExtensionsRemoveServerMessage,
  ExtensionsInstallSkillMessage,
  ExtensionsRemoveSkillMessage,
  ContextUpdateMessage,
  ViewCapturedMessage,
  PanelOfferAnswerMessage,
  PanelStatusMessage,
  PanelRefusedMessage,
  PanelClosedMessage,
]);
export type Message = z.infer<typeof Message>;
export type MessageOf<T extends Message["type"]> = Extract<Message, { type: T }>;

export type ParseResult = { ok: true; message: Message } | { ok: false; error: string };

/** Parse and validate one raw WebSocket frame. Never throws. */
export function parseMessage(raw: string): ParseResult {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ok: false, error: "Message is not valid JSON." };
  }
  const envelope = Envelope.safeParse(data);
  if (!envelope.success) {
    return { ok: false, error: z.prettifyError(envelope.error) };
  }
  const message = Message.safeParse(data);
  if (!message.success) {
    return { ok: false, error: z.prettifyError(message.error) };
  }
  return { ok: true, message: message.data };
}
