import type { Tool } from "./types.ts";

/**
 * The tools available to the palette and the keyboard. New tools can be registered at any time. A tool whose feature
 * is switched off is unavailable: it is not listed, its shortcut does nothing, and it cannot be chosen.
 */
/** What can be said to pick a tool: its own spoken names, else its label; the first is shown in the ring. */
export function spokenNames(tool: Tool): string[] {
  return tool.spoken && tool.spoken.length > 0 ? tool.spoken : [tool.label.toLowerCase()];
}

export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();
  private readonly listeners = new Set<() => void>();
  private availableFn: (tool: Tool) => boolean = () => true;

  register(tool: Tool): void {
    const clash = [...this.tools.values()].find((t) => t.id !== tool.id && t.shortcut === tool.shortcut);
    if (clash) throw new Error(`Shortcut "${tool.shortcut}" of ${tool.id} is already used by ${clash.id}`);
    this.tools.set(tool.id, tool);
    for (const listener of this.listeners) listener();
  }

  get(id: string): Tool | undefined {
    return this.tools.get(id);
  }

  /** Whether a registered tool can be used now (its feature, if any, is on). */
  isAvailable(id: string): boolean {
    const tool = this.tools.get(id);
    return tool !== undefined && this.availableFn(tool);
  }

  /** Decides which tools are available (the feature switches); call `refresh` when the answer changes. */
  setAvailability(available: (tool: Tool) => boolean): void {
    this.availableFn = available;
    this.refresh();
  }

  refresh(): void {
    for (const listener of this.listeners) listener();
  }

  byShortcut(key: string): Tool | undefined {
    return this.list().find((t) => t.shortcut === key.toLowerCase());
  }

  /** The available tools. */
  list(): Tool[] {
    return [...this.tools.values()].filter((t) => this.availableFn(t));
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
