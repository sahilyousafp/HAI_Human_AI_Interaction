import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ApprovalOutcome, ApprovalRequest, Message } from "@hai/protocol";
import type { Logger } from "../log.ts";
import { packageName } from "../python/python-env.ts";
import { HAI_SERVER } from "./agent-config.ts";

/** The tools that run code: they always show a card with the script and its packages, however the scene tools are treated. */
export const CODE_TOOLS = [`mcp__${HAI_SERVER}__python_run`, `mcp__${HAI_SERVER}__rhino_run_python`] as const;

type Send = (message: Message) => void;

/** An unanswered approval is denied after this long. */
export const APPROVAL_TIMEOUT_MS = 60_000;
/** Longest input summary shown on a card. */
const SUMMARY_MAX = 300;

/** What the permission prompt tool answers Claude Code (its documented allow / deny shape). */
export type PermissionDecision =
  | { behavior: "allow"; updatedInput: Record<string, unknown> }
  | { behavior: "deny"; message: string };

/** Where a tool comes from: the MCP server for `mcp__<server>__<tool>`, otherwise Claude Code itself. */
export function toolSource(tool: string): string {
  const match = /^mcp__(.+?)__/.exec(tool);
  return match?.[1] ?? "Claude Code";
}

/** A readable one-line summary of a tool's input: the command, path, URL or query when there is one. */
export function summarizeInput(tool: string, input: Record<string, unknown>): string {
  const pick = (...keys: string[]) =>
    keys.map((k) => input[k]).find((v) => typeof v === "string") as string | undefined;
  const known =
    tool === "Bash" ? pick("command") : pick("file_path", "notebook_path", "path", "url", "query", "pattern");
  const text = known ?? JSON.stringify(input);
  return text.length > SUMMARY_MAX ? `${text.slice(0, SUMMARY_MAX - 1)}…` : text;
}

/** A one-line card summary of a code run: its title (the card shows the script and what it would install below). */
function summarizeCode(input: Record<string, unknown>): string {
  return typeof input.title === "string" && input.title ? input.title : "Python script";
}

/** The project's "always allow" list, kept in the project's git-ignored `.hai` folder. */
export function approvalsFile(projectDir: string): string {
  return join(projectDir, ".hai", "approvals.json");
}

export function readAlwaysAllowed(projectDir: string): string[] {
  try {
    const list = JSON.parse(readFileSync(approvalsFile(projectDir), "utf8")).alwaysAllow;
    return Array.isArray(list) ? list.filter((t): t is string => typeof t === "string") : [];
  } catch {
    return [];
  }
}

function readApprovalsFile(projectDir: string): Record<string, unknown> {
  try {
    const data = JSON.parse(readFileSync(approvalsFile(projectDir), "utf8"));
    return data && typeof data === "object" && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}

function writeApprovalsFile(projectDir: string, patch: Record<string, unknown>): void {
  mkdirSync(join(projectDir, ".hai"), { recursive: true });
  writeFileSync(
    approvalsFile(projectDir),
    `${JSON.stringify({ ...readApprovalsFile(projectDir), ...patch }, null, 2)}\n`,
  );
}

function writeAlwaysAllowed(projectDir: string, tools: string[]): void {
  writeApprovalsFile(projectDir, { alwaysAllow: tools });
}

/** The packages the user has approved for Python in this project (names as pip compares them). */
export function readApprovedPackages(projectDir: string): string[] {
  const list = readApprovalsFile(projectDir).pythonPackages;
  return Array.isArray(list) ? list.filter((p): p is string => typeof p === "string") : [];
}

interface Pending {
  request: ApprovalRequest;
  settle(outcome: ApprovalOutcome, message?: string): void;
}

export interface ApprovalBrokerOptions {
  /** The open project folder, whose always-allow list applies. */
  projectDir(): string | null;
  timeoutMs?: number;
  log?: Logger;
  /** The packages a call to a code tool would install, so the card lists them and "always allow" can be checked against them. */
  pythonInstalls?(tool: string, input: Record<string, unknown>): string[];
}

/**
 * Decides the agent's tool calls for Claude Code's permission prompt tool. The app's own scene tools and the
 * project's always-allowed tools run at once; anything else becomes an approval card that the user allows or
 * denies (click, nod or shake), and that is denied if nobody answers within a minute.
 */
export class ApprovalBroker {
  private readonly pending = new Map<string, Pending>();

  constructor(
    private readonly options: ApprovalBrokerOptions,
    private readonly broadcast: Send,
  ) {}

  /** Cards waiting for a decision, oldest first (for a page that connects later). */
  get waiting(): ApprovalRequest[] {
    return [...this.pending.values()].map((p) => p.request);
  }

  get alwaysAllowed(): string[] {
    const projectDir = this.options.projectDir();
    return projectDir ? readAlwaysAllowed(projectDir) : [];
  }

  isPreApproved(tool: string, installs: string[] = []): boolean {
    if ((CODE_TOOLS as readonly string[]).includes(tool)) {
      // Code runs only with the user's say-so: always allow covers a tool, but never a package the user has not seen.
      const projectDir = this.options.projectDir();
      const approved = new Set(projectDir ? readApprovedPackages(projectDir) : []);
      return this.alwaysAllowed.includes(tool) && installs.every((spec) => approved.has(packageName(spec)));
    }
    return tool.startsWith(`mcp__${HAI_SERVER}__`) || this.alwaysAllowed.includes(tool);
  }

  /** Tells clients the open project's "Always allow" list (on connect, project change and every change). */
  announce(send: Send = this.broadcast): void {
    send({ type: "approvals.allowed", id: randomUUID(), payload: { tools: this.alwaysAllowed } });
  }

  /** The permission prompt tool, called by an agent: resolves when the call is allowed or denied. */
  decide(
    tool: string,
    input: Record<string, unknown>,
    toolUseId?: string,
    agent?: string | null,
  ): Promise<PermissionDecision> {
    const isCode = (CODE_TOOLS as readonly string[]).includes(tool);
    const installs = isCode ? (this.options.pythonInstalls?.(tool, input) ?? []) : [];
    if (this.isPreApproved(tool, installs))
      return Promise.resolve({ behavior: "allow", updatedInput: input });
    const timeoutMs = this.options.timeoutMs ?? APPROVAL_TIMEOUT_MS;
    const request: ApprovalRequest = {
      id: randomUUID(),
      tool,
      source: toolSource(tool),
      summary: isCode ? summarizeCode(input) : summarizeInput(tool, input),
      input,
      ...(isCode ? { installs } : {}),
      ...(toolUseId ? { toolUseId } : {}),
      ...(agent ? { agent } : {}),
      expiresAt: Date.now() + timeoutMs,
    };
    return new Promise((resolve) => {
      const timer = setTimeout(
        () => settle("timed-out", "The user did not answer the approval request within a minute."),
        timeoutMs,
      );
      const settle = (outcome: ApprovalOutcome, message = "The user declined this tool call.") => {
        if (!this.pending.delete(request.id)) return;
        clearTimeout(timer);
        this.options.log?.info("tool approval", { tool, outcome, ...(agent ? { agent } : {}) });
        this.broadcast({ type: "approval.resolved", id: randomUUID(), payload: { id: request.id, outcome } });
        resolve(
          outcome === "allowed" ? { behavior: "allow", updatedInput: input } : { behavior: "deny", message },
        );
      };
      this.pending.set(request.id, { request, settle });
      this.broadcast({ type: "approval.pending", id: randomUUID(), payload: request });
    });
  }

  /** Handles a decision or a revoke from a client. Returns false for other messages. */
  handle(message: Message): boolean {
    if (message.type === "approvals.revoke") {
      const projectDir = this.options.projectDir();
      if (projectDir)
        writeAlwaysAllowed(
          projectDir,
          this.alwaysAllowed.filter((t) => t !== message.payload.tool),
        );
      this.announce();
      return true;
    }
    if (message.type !== "approval.decide") return false;
    const { id, decision } = message.payload;
    const entry = this.pending.get(id);
    if (!entry) return true; // already decided (another client, or it timed out)
    if (decision === "always") this.remember(entry.request.tool, entry.request.installs);
    entry.settle(decision === "deny" ? "denied" : "allowed");
    return true;
  }

  /** Denies the waiting cards of a turn that was stopped or ended: every card, or only one agent's. */
  denyAll(message: string, agent?: string): void {
    for (const entry of [...this.pending.values()]) {
      if (agent === undefined || entry.request.agent === agent) entry.settle("denied", message);
    }
  }

  private remember(tool: string, installs: string[] = []): void {
    const projectDir = this.options.projectDir();
    if (!projectDir) return;
    const tools = readAlwaysAllowed(projectDir);
    if (!tools.includes(tool)) writeAlwaysAllowed(projectDir, [...tools, tool]);
    // The packages on this card are now known to the user: a later run that adds another one asks again.
    if (installs.length > 0) {
      const known = new Set(readApprovedPackages(projectDir));
      for (const spec of installs) known.add(packageName(spec));
      writeApprovalsFile(projectDir, { pythonPackages: [...known] });
    }
    this.announce();
  }
}
