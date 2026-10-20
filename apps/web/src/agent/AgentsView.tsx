import { AEX_TOOLS, type AgentDefinition, type AgentDefinitionInput } from "@aex/protocol";
import { type CSSProperties, type FormEvent, useState, useSyncExternalStore } from "react";
import { type AgentClient, displayName } from "./agent-client.ts";

const aex = (names: readonly string[]) => names.map((n) => `mcp__aex__${n}`);

/** What an agent may do with the app's tools, as the form offers it. */
const CAPABILITIES = [
  {
    key: "read",
    label: "Read the model",
    hint: "summary, elements, what you point at, the view",
    tools: aex(AEX_TOOLS.read),
  },
  {
    key: "write",
    label: "Change the model",
    hint: "one such agent works at a time",
    tools: aex(AEX_TOOLS.write),
  },
  {
    key: "climate",
    label: "Sun studies",
    hint: "sets the sun for a date, time and place",
    tools: aex(AEX_TOOLS.climate),
  },
] as const;
const TEAM_TOOLS = aex(AEX_TOOLS.team);
const AEX_TOOL_NAMES: ReadonlySet<string> = new Set([...CAPABILITIES.flatMap((c) => c.tools), ...TEAM_TOOLS]);
const MODELS = ["sonnet", "opus", "haiku", "inherit"] as const;
const NEW_COLORS = ["#f0786d", "#c9a0f0", "#7fb3e6", "#d4c06a", "#6cc4a4"];

type Capability = (typeof CAPABILITIES)[number]["key"];

interface Draft {
  name: string;
  description: string;
  model: string;
  color: string;
  aliases: string;
  capabilities: Record<Capability, boolean>;
  otherTools: string;
  prompt: string;
}

const list = (text: string) =>
  text
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

function draftOf(agent: AgentDefinition | null, index: number): Draft {
  const has = (tools: readonly string[]) => tools.some((t) => agent?.tools.includes(t));
  return {
    name: agent?.name ?? "",
    description: agent?.description ?? "",
    model: agent?.model ?? "sonnet",
    color: agent?.color ?? (NEW_COLORS[index % NEW_COLORS.length] as string),
    aliases: agent?.aliases.join(", ") ?? "",
    capabilities: {
      read: agent ? has(aex(AEX_TOOLS.read)) : true,
      write: agent ? has(aex(AEX_TOOLS.write)) : false,
      climate: agent ? has(aex(AEX_TOOLS.climate)) : false,
    },
    otherTools: agent?.tools.filter((t) => !AEX_TOOL_NAMES.has(t)).join(", ") ?? "",
    prompt: agent?.prompt ?? "",
  };
}

function inputOf(draft: Draft, lead: boolean): AgentDefinitionInput {
  const tools = [
    ...(lead ? TEAM_TOOLS : []),
    ...CAPABILITIES.filter((c) => draft.capabilities[c.key]).flatMap((c) => c.tools),
    ...list(draft.otherTools),
  ];
  return {
    name: draft.name.trim(),
    description: draft.description.trim(),
    ...(draft.model ? { model: draft.model } : {}),
    tools,
    aliases: list(draft.aliases),
    color: draft.color,
    prompt: draft.prompt.trim(),
  };
}

const NAME = /^[a-z][a-z0-9-]{0,31}$/;
/** The add form's key: never an agent name, which starts with a letter. */
const NEW_AGENT = "+new";

/** The form to add an agent (`agent` null) or edit one. */
function AgentForm({
  agent,
  index,
  taken,
  client,
  busy,
  onDone,
}: {
  agent: AgentDefinition | null;
  index: number;
  taken: string[];
  client: AgentClient;
  busy: boolean;
  onDone: () => void;
}) {
  const [draft, setDraft] = useState(() => draftOf(agent, index));
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const lead = agent?.lead ?? false;
  const name = draft.name.trim();
  let nameError = "";
  if (!agent && name && !NAME.test(name))
    nameError = "Lower-case letters, digits and -, starting with a letter.";
  else if (!agent && taken.includes(name)) nameError = "There is already an agent with this name.";
  const ready =
    NAME.test(name) && !nameError && draft.description.trim() !== "" && draft.prompt.trim() !== "";

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!ready || busy) return;
    if (client.saveAgent(inputOf(draft, lead))) onDone();
  };

  return (
    <form className="extension-form agent-form" onSubmit={submit} data-testid="agent-form">
      <label>
        <span>Name (say it to address the agent)</span>
        <input
          value={draft.name}
          disabled={agent !== null}
          placeholder="structure"
          data-testid="agent-name"
          onChange={(e) => set({ name: e.target.value.toLowerCase() })}
        />
        {nameError && (
          <span className="agent-form-error" role="alert">
            {nameError}
          </span>
        )}
      </label>
      <label>
        <span>What it does (Mochi reads this to choose it)</span>
        <textarea
          rows={2}
          maxLength={300}
          className="agent-description-input"
          value={draft.description}
          placeholder="Sizes beams and columns."
          data-testid="agent-description"
          onChange={(e) => set({ description: e.target.value })}
        />
      </label>
      <div className="agent-form-row">
        <label>
          <span>Model</span>
          <select
            value={draft.model}
            data-testid="agent-model"
            onChange={(e) => set({ model: e.target.value })}
          >
            {MODELS.map((m) => (
              <option key={m} value={m}>
                {m === "inherit" ? "same as Claude Code" : m}
              </option>
            ))}
          </select>
        </label>
        <label className="agent-form-color">
          <span>Colour</span>
          <input type="color" value={draft.color} onChange={(e) => set({ color: e.target.value })} />
        </label>
      </div>
      <label>
        <span>Other names it is heard as (comma-separated)</span>
        <input
          value={draft.aliases}
          placeholder="struct, structures"
          data-testid="agent-aliases"
          onChange={(e) => set({ aliases: e.target.value })}
        />
      </label>
      <fieldset className="agent-capabilities">
        <legend>What it may do</legend>
        {lead && (
          <label>
            <input type="checkbox" checked disabled />
            <span>
              Hand out work <span className="muted">(the team lead)</span>
            </span>
          </label>
        )}
        {CAPABILITIES.map((c) => (
          <label key={c.key}>
            <input
              type="checkbox"
              checked={draft.capabilities[c.key]}
              data-testid={`agent-can-${c.key}`}
              onChange={(e) => set({ capabilities: { ...draft.capabilities, [c.key]: e.target.checked } })}
            />
            <span>
              {c.label} <span className="muted">({c.hint})</span>
            </span>
          </label>
        ))}
      </fieldset>
      <label>
        <span>Other Claude Code tools (comma-separated, e.g. Read, WebSearch)</span>
        <input value={draft.otherTools} onChange={(e) => set({ otherTools: e.target.value })} />
      </label>
      <label>
        <span>Instructions</span>
        <textarea
          rows={6}
          value={draft.prompt}
          placeholder="You are Structure. You size beams and columns..."
          data-testid="agent-prompt"
          onChange={(e) => set({ prompt: e.target.value })}
        />
      </label>
      <div className="agent-form-actions">
        <button type="submit" className="primary" disabled={!ready || busy} data-testid="agent-save">
          {agent ? "Save" : "Add agent"}
        </button>
        <button type="button" className="secondary" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/**
 * The team's definitions: each agent's model, tools and what it does, from the project's `.claude/agents` files, and
 * a form to add or edit one. A change applies from that agent's next task.
 */
export function AgentsView({ client }: { client: AgentClient }) {
  const {
    agents,
    agentsBusy: busy,
    agentsResult: result,
  } = useSyncExternalStore(client.subscribe, client.getSnapshot);
  /** The agent being edited, NEW_AGENT for the add form, or null. */
  const [editing, setEditing] = useState<string | null>(null);
  const editedAgent = agents?.find((a) => a.name === editing) ?? null;

  return (
    <div className="extensions-view" data-testid="agents-view">
      {(busy || result) && (
        <p
          className="extensions-result"
          data-testid="agents-result"
          data-ok={result?.ok ?? true}
          role={result && !result.ok ? "alert" : "status"}
        >
          {busy ? "Saving..." : result?.message}
        </p>
      )}
      {editing !== null ? (
        <section className="extensions-section" aria-labelledby="agent-form-title">
          <h3 id="agent-form-title">
            {editedAgent ? `Edit ${displayName(editedAgent.name)}` : "Add an agent"}
          </h3>
          <AgentForm
            key={editing}
            agent={editedAgent}
            index={agents?.length ?? 0}
            taken={agents?.map((a) => a.name) ?? []}
            client={client}
            busy={busy}
            onDone={() => setEditing(null)}
          />
        </section>
      ) : (
        <section className="extensions-section" aria-labelledby="agents-title">
          <h3 id="agents-title">The team in this project</h3>
          {agents?.length ? (
            <ul className="extension-list">
              {agents.map((agent) => (
                <li
                  key={agent.name}
                  className="agent-definition"
                  data-testid="agent-definition"
                  style={{ "--agent-color": agent.color } as CSSProperties}
                >
                  <span className="team-dot" aria-hidden="true" />
                  <span className="extension-name">{displayName(agent.name)}</span>
                  {agent.lead && <span className="extension-scope">lead</span>}
                  {agent.model && <span className="extension-scope">{agent.model}</span>}
                  {agent.writes && <span className="extension-scope">changes the model</span>}
                  <button
                    type="button"
                    className="secondary"
                    data-hand-press
                    aria-label={`Edit ${displayName(agent.name)}`}
                    onClick={() => setEditing(agent.name)}
                  >
                    Edit
                  </button>
                  <span className="extension-description">{agent.description}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">
              The team is created with the first request: Mochi, Architect, Product, Climate and Reviewer, as
              Claude Code agent files in .claude/agents.
            </p>
          )}
          <button
            type="button"
            className="link-button agent-add"
            data-testid="agent-add"
            data-hand-press
            onClick={() => setEditing(NEW_AGENT)}
          >
            Add an agent
          </button>
        </section>
      )}
    </div>
  );
}
