import { randomBytes, timingSafeEqual } from "node:crypto";

/** Who is calling the MCP endpoint: an agent's process, known by the token it was started with. */
export interface Caller {
  /** The team agent (`claude --agent <name>`); null for the single unnamed session. */
  agent: string | null;
  /** The `aex` tools it may call, by short name; null for all of them. */
  tools: ReadonlySet<string> | null;
}

/**
 * The MCP tokens of the running agent processes. Each process gets its own random token in its generated
 * `mcp.json`, so the endpoint knows which agent is calling and offers it only its own tools. Issuing a new token for
 * an agent revokes its previous one (that process has ended). The browsers' session token is never one of these.
 */
export class AgentTokens {
  private readonly issued = new Map<string, { token: Buffer; caller: Caller }>();

  /** A new token for this agent's next process. */
  issue(caller: Caller): string {
    const token = randomBytes(32).toString("base64url");
    this.issued.set(caller.agent ?? "", { token: Buffer.from(token), caller });
    return token;
  }

  /** The tokens now valid (for redacting logs). */
  get current(): string[] {
    return [...this.issued.values()].map(({ token }) => token.toString());
  }

  /** The agent a presented token belongs to, compared in constant time; null for any other token. */
  identify(presented: string): Caller | null {
    const given = Buffer.from(presented);
    let found: Caller | null = null;
    // Every entry is compared, so the time taken does not tell which agent (if any) a token is close to.
    for (const { token, caller } of this.issued.values()) {
      if (token.length === given.length && timingSafeEqual(token, given)) found = caller;
    }
    return found;
  }
}
