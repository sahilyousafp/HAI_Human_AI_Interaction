import { randomUUID } from "node:crypto";

/** Aborted when either the protocol cancels the call or the agent ends the HTTP request. */
export const stopSignal = (...signals: Array<AbortSignal | undefined>): AbortSignal =>
  AbortSignal.any(signals.filter((s): s is AbortSignal => s !== undefined));

/** An id nobody has: generated ones are checked against the model and this batch, never assumed to be free. */
export function freshId(type: unknown, taken: ReadonlySet<string>): string {
  for (;;) {
    const id = `${String(type ?? "element")}-${randomUUID().slice(0, 8)}`;
    if (!taken.has(id)) return id;
  }
}
