import type { Tool } from "./types.ts";

/** The tools available to the palette and the keyboard. New tools can be registered at any time. */
export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();
  private readonly listeners = new Set<() => void>();

  register(tool: Tool): void {
    const clash = [...this.tools.values()].find((t) => t.id !== tool.id && t.shortcut === tool.shortcut);
    if (clash) throw new Error(`Shortcut "${tool.shortcut}" of ${tool.id} is already used by ${clash.id}`);
    this.tools.set(tool.id, tool);
    for (const listener of this.listeners) listener();
  }

  get(id: string): Tool | undefined {
    return this.tools.get(id);
  }

  byShortcut(key: string): Tool | undefined {
    return [...this.tools.values()].find((t) => t.shortcut === key.toLowerCase());
  }

  list(): Tool[] {
    return [...this.tools.values()];
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
