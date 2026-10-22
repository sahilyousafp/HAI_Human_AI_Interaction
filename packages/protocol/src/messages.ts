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
  RequestContext,
  TeamMemberInfo,
  TeamTask,
} from "./agent.ts";
import { GestureBindingsSchema } from "./bindings.ts";
import { DrawingAidChoices } from "./drawing-aids.ts";
import { BridgeStatusMessage, Envelope, HelloMessage, MessageId } from "./envelope.ts";
import { FeatureChoices } from "./features.ts";
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

/** User settings kept by the bridge in .hai/settings.json. */
export const Settings = z.strictObject({
  /** The tools ring (the right hand's long pinch); null until the user changes it: the app's default applies. */
  palette: PaletteLayout.nullable(),
  /** The create ring (the left hand's long pinch); null until the user changes it. */
  createPalette: PaletteLayout.nullable().default(null),
  /** What each gesture does, where the user changed it; the rest keep their defaults. */
  gestures: GestureBindingsSchema.nullable().default(null),
  /** Where speech is turned into text: on this laptop (default), or the browser's cloud service (opt-in). */
  speech: SpeechMode.default("device"),
  /** Keep the microphone open and turn only utterances that start with a team name into requests (opt-in). */
  listenForNames: z.boolean().default(false),
  /** Whether Mochi's replies are spoken (on by default; muting is remembered). */
  speakReplies: z.boolean().default(true),
  replyVoice: ReplyVoice.default("af_heart"),
  /** Features the user switched on or off; the rest are on. */
  features: FeatureChoices.nullable().default(null),
  /** Drawing aids the user switched on or off; the rest keep their defaults (only Grid is on). */
  drawingAids: DrawingAidChoices.nullable().default(null),
  /** Draw the user's hands as white shapes over the whole screen, so people watching a recording can follow. */
  showHands: z.boolean().default(false),
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
    /** How many specialists may run at once. */
    maxRunning: z.number().int().min(1),
  }),
);
/** The project's agent definitions (Agents tab); `saved` names the agent just saved. */
export const AgentsSnapshotMessage = message(
  "agents.snapshot",
  z.strictObject({ definitions: z.array(AgentDefinition), saved: z.string().optional() }),
);
export const ApprovalPendingMessage = message("approval.pending", ApprovalRequest);
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
  z.strictObject({ requestId: z.string(), sun: SunSetting.optional() }),
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

// Clients -> bridge
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
    gestures: GestureBindingsSchema.optional(),
    speech: SpeechMode.optional(),
    listenForNames: z.boolean().optional(),
    speakReplies: z.boolean().optional(),
    replyVoice: ReplyVoice.optional(),
    features: FeatureChoices.optional(),
    drawingAids: DrawingAidChoices.optional(),
    showHands: z.boolean().optional(),
  }),
);
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
    error: z.string().optional(),
  }),
);
/** Stops everything the team is doing (Mochi's turn and every task). */
export const AgentStopMessage = message("agent.stop", z.strictObject({}));
/** Adds or changes an agent of the open project's team. */
export const AgentsSaveMessage = message("agents.save", z.strictObject({ agent: AgentDefinitionInput }));
/** Stops one task, or takes it off the queue. */
export const TaskStopMessage = message("task.stop", z.strictObject({ id: z.string() }));
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

export const Message = z.discriminatedUnion("type", [
  HelloMessage,
  BridgeStatusMessage,
  SceneSnapshotMessage,
  ScenePatchMessage,
  SelectionChangedMessage,
  ProjectStatusMessage,
  RequestErrorMessage,
  SettingsSnapshotMessage,
  AgentStatusMessage,
  AgentTranscriptMessage,
  AgentTurnStartMessage,
  AgentEventMessage,
  TeamSnapshotMessage,
  AgentsSnapshotMessage,
  ApprovalPendingMessage,
  ApprovalResolvedMessage,
  ApprovalsAllowedMessage,
  ExtensionsSnapshotMessage,
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
  TaskStopMessage,
  AgentsSaveMessage,
  ApprovalDecideMessage,
  ApprovalsRevokeMessage,
  ExtensionsAddServerMessage,
  ExtensionsRemoveServerMessage,
  ExtensionsInstallSkillMessage,
  ExtensionsRemoveSkillMessage,
  ContextUpdateMessage,
  ViewCapturedMessage,
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
