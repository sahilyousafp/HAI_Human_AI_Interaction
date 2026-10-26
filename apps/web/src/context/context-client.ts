import type { ContextCredit, ContextItem, Message } from "@hai/protocol";

/** The city context the bridge holds: buildings, trees and ground data, outside the model. */
export interface ContextState {
  items: ContextItem[];
  /** Built for another site than the project has now. */
  stale: boolean;
  credits: ContextCredit[];
}

const EMPTY: ContextState = { items: [], stale: false, credits: [] };

/** The browser's side of the context layer: whatever the bridge last sent. It is read-only here. */
export class ContextClient {
  private state = EMPTY;
  private readonly listeners = new Set<() => void>();

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): ContextState => this.state;

  /** Handles a bridge message; false if it was not about the context. */
  handle(message: Message): boolean {
    if (message.type !== "context.snapshot") return false;
    const { items, stale, credits } = message.payload;
    this.state = { items, stale, credits };
    for (const listener of this.listeners) listener();
    return true;
  }
}
