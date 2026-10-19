import { z } from "zod";
import { BridgeStatusMessage, Envelope, HelloMessage, MessageId } from "./envelope.ts";
import { ElementId, SceneDocument, SceneOp } from "./scene.ts";

function message<T extends string, P extends z.ZodType>(type: T, payload: P) {
  return z.strictObject({ type: z.literal(type), id: MessageId, payload });
}

const UndoState = { canUndo: z.boolean(), canRedo: z.boolean() };
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
/** Reply to a client request that could not be applied (for example an invalid transaction). */
export const RequestErrorMessage = message(
  "request.error",
  z.strictObject({ requestId: MessageId, message: z.string() }),
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

export const Message = z.discriminatedUnion("type", [
  HelloMessage,
  BridgeStatusMessage,
  SceneSnapshotMessage,
  ScenePatchMessage,
  SelectionChangedMessage,
  ProjectStatusMessage,
  RequestErrorMessage,
  SceneApplyMessage,
  SceneUndoMessage,
  SceneRedoMessage,
  SceneResyncMessage,
  SelectionSetMessage,
  ProjectOpenMessage,
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
