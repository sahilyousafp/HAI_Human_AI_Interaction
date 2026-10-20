import type { McpServerSpec } from "@aex/protocol";
import { type FormEvent, useState, useSyncExternalStore } from "react";
import type { AgentClient } from "./agent-client.ts";

type Pair = { key: string; value: string };
const STATUS_TONE: Record<string, "ok" | "risk" | "warn"> = {
  connected: "ok",
  failed: "risk",
  pending: "warn",
  "needs-auth": "warn",
};
const SCOPE_LABEL: Record<string, string> = {
  user: "user",
  project: "project",
  local: "local",
  plugin: "plugin",
  "claude.ai": "claude.ai",
  session: "this app",
  unknown: "",
};

/** Key / secret-value rows (environment variables or headers); values are typed into password fields. */
function SecretRows({
  label,
  keyLabel,
  rows,
  onChange,
}: {
  label: string;
  keyLabel: string;
  rows: Pair[];
  onChange: (rows: Pair[]) => void;
}) {
  const set = (i: number, patch: Partial<Pair>) =>
    onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <fieldset className="secret-rows">
      <legend>{label}</legend>
      {rows.map((row, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: rows have no identity of their own while being typed
        <div key={i} className="secret-row">
          <input
            aria-label={`${keyLabel} ${i + 1}`}
            placeholder={keyLabel}
            value={row.key}
            onChange={(e) => set(i, { key: e.target.value })}
          />
          <input
            type="password"
            autoComplete="off"
            aria-label={`Value ${i + 1} (hidden)`}
            placeholder="value (hidden)"
            value={row.value}
            onChange={(e) => set(i, { value: e.target.value })}
          />
          <button
            type="button"
            className="secondary"
            aria-label={`Remove ${keyLabel.toLowerCase()} ${i + 1}`}
            onClick={() => onChange(rows.filter((_, j) => j !== i))}
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        className="link-button"
        onClick={() => onChange([...rows, { key: "", value: "" }])}
      >
        Add {keyLabel.toLowerCase()}
      </button>
    </fieldset>
  );
}

const toRecord = (rows: Pair[]) =>
  Object.fromEntries(rows.filter((r) => r.key.trim()).map((r) => [r.key.trim(), r.value]));

function AddServerForm({ client, busy }: { client: AgentClient; busy: boolean }) {
  const [name, setName] = useState("");
  const [transport, setTransport] = useState<"stdio" | "http">("stdio");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [url, setUrl] = useState("");
  const [secrets, setSecrets] = useState<Pair[]>([]);
  const ready = name.trim() !== "" && (transport === "stdio" ? command.trim() !== "" : url.trim() !== "");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!ready || busy) return;
    const server: McpServerSpec =
      transport === "stdio"
        ? {
            transport,
            name: name.trim(),
            command: command.trim(),
            args: args
              .split(/\r?\n/)
              .map((a) => a.trim())
              .filter(Boolean),
            env: toRecord(secrets),
          }
        : { transport, name: name.trim(), url: url.trim(), headers: toRecord(secrets) };
    if (client.addServer(server)) {
      setName("");
      setCommand("");
      setArgs("");
      setUrl("");
      setSecrets([]);
    }
  };

  return (
    <form className="extension-form" onSubmit={submit} data-testid="add-server-form">
      <label>
        <span>Name</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="files"
          data-testid="server-name"
        />
      </label>
      <div className="segmented" role="radiogroup" aria-label="Server type">
        {(["stdio", "http"] as const).map((t) => (
          <label key={t}>
            <input type="radio" name="transport" checked={transport === t} onChange={() => setTransport(t)} />
            <span>{t === "stdio" ? "Command (stdio)" : "URL (HTTP)"}</span>
          </label>
        ))}
      </div>
      {transport === "stdio" ? (
        <>
          <label>
            <span>Command</span>
            <input
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder="npx"
              data-testid="server-command"
            />
          </label>
          <label>
            <span>Arguments, one per line</span>
            <textarea
              rows={2}
              value={args}
              onChange={(e) => setArgs(e.target.value)}
              placeholder={"-y\n@scope/some-mcp-server"}
              data-testid="server-args"
            />
          </label>
        </>
      ) : (
        <label>
          <span>URL</span>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://mcp.example.com/mcp"
            data-testid="server-url"
          />
        </label>
      )}
      <SecretRows
        label={transport === "stdio" ? "Environment variables" : "Headers"}
        keyLabel={transport === "stdio" ? "Variable" : "Header"}
        rows={secrets}
        onChange={setSecrets}
      />
      <button type="submit" className="primary" disabled={!ready || busy} data-testid="add-server">
        Add server
      </button>
    </form>
  );
}

/**
 * The agent's extensions: the MCP servers and skills the session loaded (with status), and the open project's own
 * servers and skills, which can be added and removed. Secret values are typed into password fields and never shown.
 */
export function ExtensionsView({ client }: { client: AgentClient }) {
  const {
    extensions,
    extensionsBusy: busy,
    extensionsResult: result,
  } = useSyncExternalStore(client.subscribe, client.getSnapshot);
  const [source, setSource] = useState("");
  const install = (e: FormEvent) => {
    e.preventDefault();
    if (source.trim() && !busy && client.installSkill(source.trim())) setSource("");
  };
  const loaded = extensions?.loaded ?? null;

  return (
    <div className="extensions-view" data-testid="extensions-view">
      {(busy || result) && (
        <p
          className="extensions-result"
          data-testid="extensions-result"
          data-ok={result?.ok ?? true}
          role={result && !result.ok ? "alert" : "status"}
        >
          {busy ? "Applying the change..." : result?.message}
        </p>
      )}

      <section className="extensions-section" aria-labelledby="loaded-title">
        <h3 id="loaded-title">Loaded in this session</h3>
        {loaded === null ? (
          <p className="muted">Shown once the agent has started: send it a request first.</p>
        ) : (
          <>
            <ul className="extension-list">
              {loaded.servers.map((server) => (
                <li key={server.name} data-testid="loaded-server" data-status={server.status}>
                  <span className="extension-name">{server.name}</span>
                  {SCOPE_LABEL[server.scope] && (
                    <span className="extension-scope">{SCOPE_LABEL[server.scope]}</span>
                  )}
                  <span className="extension-status" data-tone={STATUS_TONE[server.status] ?? "warn"}>
                    {server.status}
                  </span>
                  {server.error && <span className="extension-error">{server.error}</span>}
                </li>
              ))}
            </ul>
            {loaded.skills.length > 0 && (
              <p className="extension-skills" data-testid="loaded-skills">
                <span className="muted">Skills: </span>
                {loaded.skills.map((s) => s.name).join(", ")}
              </p>
            )}
          </>
        )}
      </section>

      <section className="extensions-section" aria-labelledby="project-servers-title">
        <h3 id="project-servers-title">MCP servers in this project</h3>
        {extensions?.projectServers.length ? (
          <ul className="extension-list">
            {extensions.projectServers.map((server) => (
              <li key={server.name} data-testid="project-server">
                <span className="extension-name">{server.name}</span>
                <span className="extension-scope">{server.transport}</span>
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  aria-label={`Remove the MCP server ${server.name}`}
                  onClick={() => client.removeServer(server.name)}
                >
                  Remove
                </button>
                <code className="extension-target">{server.target}</code>
                {[...server.envKeys, ...server.headerKeys].map((key) => (
                  <code key={key} className="extension-secret" data-testid="masked-secret">
                    {key}: ••••••
                  </code>
                ))}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">
            None yet. Servers added here go in the project's .mcp.json, so Claude Code uses them too.
          </p>
        )}
        <details className="extension-add">
          <summary>Add a server</summary>
          <AddServerForm client={client} busy={busy} />
        </details>
      </section>

      <section className="extensions-section" aria-labelledby="project-skills-title">
        <h3 id="project-skills-title">Skills in this project</h3>
        {extensions?.projectSkills.length ? (
          <ul className="extension-list">
            {extensions.projectSkills.map((skill) => (
              <li key={skill.name} data-testid="project-skill">
                <span className="extension-name">{skill.name}</span>
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  aria-label={`Remove the skill ${skill.name}`}
                  onClick={() => client.removeSkill(skill.name)}
                >
                  Remove
                </button>
                {skill.description && <span className="extension-description">{skill.description}</span>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">None yet. Skills installed here go in .claude/skills in the project.</p>
        )}
        <form className="extension-install" onSubmit={install}>
          <input
            value={source}
            onChange={(e) => setSource(e.target.value)}
            placeholder="Folder path or https git URL"
            aria-label="Skill folder or git URL"
            data-testid="skill-source"
          />
          <button
            type="submit"
            className="secondary"
            disabled={!source.trim() || busy}
            data-testid="install-skill"
          >
            Install
          </button>
        </form>
      </section>
    </div>
  );
}
