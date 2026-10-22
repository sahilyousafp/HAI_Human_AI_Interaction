import { randomUUID } from "node:crypto";
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type AgentProvider, run as defaultRun, type Run } from "@hai/agent-core";
import {
  type AgentEvent,
  type AgentSkill,
  ExtensionName,
  type ExtensionsState,
  type Message,
  type ProjectMcpServer,
} from "@hai/protocol";
import type { Logger } from "../log.ts";
import { parseFrontmatter } from "./frontmatter.ts";

type Send = (message: Message) => void;
type Init = Extract<AgentEvent, { type: "init" }>;

/** Where a project's skills live: Claude Code loads `<project>/.claude/skills/<name>/SKILL.md`. */
export const skillsDir = (projectDir: string) => join(projectDir, ".claude", "skills");

/** The project's MCP servers from Claude Code's `.mcp.json`, without any env or header values. */
export function readProjectServers(projectDir: string): ProjectMcpServer[] {
  let servers: Record<string, Record<string, unknown>>;
  try {
    servers = JSON.parse(readFileSync(join(projectDir, ".mcp.json"), "utf8")).mcpServers ?? {};
  } catch {
    return [];
  }
  return Object.entries(servers).map(([name, config]) => {
    const transport = typeof config.type === "string" ? config.type : "stdio";
    const args = Array.isArray(config.args) ? config.args.map(String) : [];
    const keys = (value: unknown) => (value && typeof value === "object" ? Object.keys(value) : []);
    return {
      name,
      transport,
      target: typeof config.url === "string" ? config.url : [String(config.command ?? ""), ...args].join(" "),
      envKeys: keys(config.env),
      headerKeys: keys(config.headers),
    };
  });
}

/** The `name` and `description` from a SKILL.md's front matter, or why it is not a valid skill. */
export function parseSkill(text: string): { name: string; description: string } | { error: string } {
  const parsed = parseFrontmatter(text);
  if (!parsed)
    return {
      error: "SKILL.md has no front matter (a block between --- lines with a name and a description).",
    };
  const { fields } = parsed;
  if (!fields.name) return { error: "SKILL.md has no name in its front matter." };
  if (!ExtensionName.safeParse(fields.name).success)
    return { error: `The skill name "${fields.name}" must use letters, digits, - and _ only.` };
  if (!fields.description) return { error: "SKILL.md has no description in its front matter." };
  return { name: fields.name, description: fields.description };
}

/** The skills installed in the project. */
export function readProjectSkills(projectDir: string): AgentSkill[] {
  const dir = skillsDir(projectDir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((entry) => {
    try {
      const skill = parseSkill(readFileSync(join(dir, entry, "SKILL.md"), "utf8"));
      return "error" in skill
        ? []
        : [{ name: skill.name, description: skill.description, scope: "project" as const }];
    } catch {
      return [];
    }
  });
}

export interface ExtensionHubOptions {
  projectDir(): string | null;
  /** The agent provider; without one, nothing can be added. */
  provider: AgentProvider | null;
  /** Restarts the agent session so a change applies; the conversation resumes on the next request. */
  restart(): Promise<void>;
  /** Runs git for skills installed from a repository (injected in tests). */
  run?: Run;
  log?: Logger;
}

/**
 * The agent's extensions: what the session actually loaded (from its init event), and the open project's MCP
 * servers and skills, which the user can add and remove. Every change restarts the session, which resumes the same
 * conversation, so it applies from the next request.
 */
export class ExtensionHub {
  private loaded: ExtensionsState["loaded"] = null;

  constructor(
    private readonly options: ExtensionHubOptions,
    private readonly broadcast: Send,
  ) {}

  greet(send: Send): void {
    send(this.snapshot());
  }

  /** The session started: remember what it loaded. */
  initialized(event: Init): void {
    this.loaded = { servers: event.mcpServers, skills: event.skills };
    this.broadcast(this.snapshot());
  }

  /** Another project opened: its servers and skills, and nothing loaded yet. */
  projectChanged(): void {
    this.loaded = null;
    this.broadcast(this.snapshot());
  }

  /** Handles an extension message from a client. Returns false for other messages. */
  handle(message: Message, send: Send): boolean {
    const apply = (change: (projectDir: string) => Promise<string>) => {
      const projectDir = this.options.projectDir();
      const done = projectDir ? change(projectDir) : Promise.reject(new Error("Open a project first."));
      void done.then(
        async (notice) => {
          // The message itself may carry secrets (env, headers); the logger redacts them.
          this.options.log?.info("extension change applied", {
            change: message.type,
            payload: message.payload,
          });
          await this.options.restart();
          this.broadcast(this.snapshot(notice));
        },
        (error: Error) => {
          this.options.log?.info("extension change refused", { change: message.type, reason: error.message });
          send({
            type: "request.error",
            id: randomUUID(),
            payload: { requestId: message.id, message: error.message },
          });
        },
      );
    };
    switch (message.type) {
      case "extensions.addServer": {
        const { server } = message.payload;
        apply(async (projectDir) => {
          await this.extensions().addServer(projectDir, server);
          return `Added the MCP server ${server.name}. It is active from your next request; the conversation continues.`;
        });
        return true;
      }
      case "extensions.removeServer": {
        const { name } = message.payload;
        apply(async (projectDir) => {
          await this.extensions().removeServer(projectDir, name);
          return `Removed the MCP server ${name}. The conversation continues without it.`;
        });
        return true;
      }
      case "extensions.installSkill":
        apply(async (projectDir) => {
          const name = await this.installSkill(projectDir, message.payload.source.trim());
          return `Installed the skill ${name}. It is available from your next request.`;
        });
        return true;
      case "extensions.removeSkill": {
        const { name } = message.payload;
        apply(async (projectDir) => {
          const dir = join(skillsDir(projectDir), name);
          if (!existsSync(join(dir, "SKILL.md")))
            throw new Error(`No skill named ${name} is installed in this project.`);
          rmSync(dir, { recursive: true, force: true });
          return `Removed the skill ${name}.`;
        });
        return true;
      }
      default:
        return false;
    }
  }

  private extensions() {
    const extensions = this.options.provider?.extensions;
    if (!extensions) throw new Error("The agent is not set up, so MCP servers cannot be added here.");
    return extensions;
  }

  /** Copies a skill from a folder, or from a shallow clone of an https git repository, after checking SKILL.md. */
  private async installSkill(projectDir: string, source: string): Promise<string> {
    let folder = source;
    let clone: string | null = null;
    try {
      if (/^https:\/\//i.test(source)) {
        clone = mkdtempSync(join(tmpdir(), "hai-skill-"));
        const result = await (this.options.run ?? defaultRun)(
          "git",
          ["clone", "--depth", "1", "--", source, clone],
          {
            timeoutMs: 120_000,
          },
        );
        if (result.code !== 0)
          throw new Error(
            `Could not clone ${source}: ${(result.error?.message ?? result.stderr).trim().split(/\r?\n/).at(-1)}`,
          );
        folder = clone;
      } else if (!existsSync(folder) || !statSync(folder).isDirectory()) {
        throw new Error(
          `${source} is not a folder. Give a folder that contains SKILL.md, or an https git URL.`,
        );
      }
      const manifest = join(folder, "SKILL.md");
      if (!existsSync(manifest))
        throw new Error(
          `SKILL.md is missing in ${source}. A skill folder needs a SKILL.md with a name and a description.`,
        );
      const skill = parseSkill(readFileSync(manifest, "utf8"));
      if ("error" in skill) throw new Error(skill.error);
      const target = join(skillsDir(projectDir), skill.name);
      if (existsSync(target))
        throw new Error(`A skill named ${skill.name} is already installed here. Remove it first.`);
      cpSync(folder, target, { recursive: true, filter: (path) => !/[\\/]\.git([\\/]|$)/.test(path) });
      return skill.name;
    } finally {
      if (clone) rmSync(clone, { recursive: true, force: true });
    }
  }

  private snapshot(notice?: string): Message {
    const projectDir = this.options.projectDir();
    return {
      type: "extensions.snapshot",
      id: randomUUID(),
      payload: {
        loaded: this.loaded,
        projectServers: projectDir ? readProjectServers(projectDir) : [],
        projectSkills: projectDir ? readProjectSkills(projectDir) : [],
        ...(notice ? { notice } : {}),
      },
    };
  }
}
