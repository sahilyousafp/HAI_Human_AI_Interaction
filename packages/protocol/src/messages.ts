import { z } from "zod";
import {
  AgentEvent,
  AgentStatus,
  AgentTurn,
  ApprovalOutcome,
  ApprovalRequest,
  ExtensionName,
  ExtensionsState,
  McpServerSpec,
} from "./agent.ts";
import { GestureBindingsSchema } from "./bindings.ts";
import { BridgeStatusMessage, Envelope, HelloMessage, MessageId } from "./envelope.ts";
import { ElementId, SceneDocument, SceneOp } from "./scene.ts";

function message<T extends string, P extends z.ZodType>(type: T, payload: P) {
  return z.strictObject({ type: z.literal(type), id: MessageId, payload });
}

const UndoState = { canUndo: z.boolean(), canRedo: z.boolean() };

/** Tool id per palette slot, clockwise from the top; null is an empty slot. */
export const PaletteLayout = z.array(z.string().min(1).max(64).nullable()).length(8);
export type PaletteLayout = z.infer<typeof PaletteLayout>;

/** User settings kept by the bridge in .aex/settings.json. */
export const Settings = z.strictObject({
  /** null until the user changes the layout: the app's default applies. */
  palette: PaletteLayout.nullable(),
  /** What each gesture does, where the user changed it; the rest keep their defaults. */
  gestures: GestureBindingsSchema.nullable().default(null),
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
export const AgentStatusMessage = message("agent.status", z.strictObject({ status: AgentStatus }));
/** Everything so far in this session: sent on connect, so a reloaded page shows the whole conversation. */
export const AgentTranscriptMessage = message(
  "agent.transcript",
  z.strictObject({ turns: z.array(AgentTurn), status: AgentStatus, pending: z.array(ApprovalRequest) }),
);
export const AgentTurnStartMessage = message(
  "agent.turn",
  z.strictObject({ id: z.string(), request: z.string(), recovered: z.boolean() }),
);
export const AgentEventMessage = message(
  "agent.event",
  z.strictObject({ turnId: z.string(), event: AgentEvent }),
);
export const ApprovalPendingMessage = message("approval.pending", ApprovalRequest);
/** The agent asked to see the view: a viewer answers with a PNG. */
export const ViewCaptureMessage = message("view.capture", z.strictObject({ requestId: z.string() }));
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
/** Changes one or more settings; what is left out keeps its value. */
export const SettingsSetMessage = message(
  "settings.set",
  z.strictObject({ palette: PaletteLayout.optional(), gestures: GestureBindingsSchema.optional() }),
);
export const AgentSendMessage = message("agent.send", z.strictObject({ text: z.string().min(1).max(8000) }));
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
export const AgentStopMessage = message("agent.stop", z.strictObject({}));
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
  SettingsSetMessage,
  AgentSendMessage,
  AgentStopMessage,
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
