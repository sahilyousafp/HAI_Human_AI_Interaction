/**
 * The front matter of a Markdown definition (Claude Code agents, skills): the `key: value` block between `---`
 * lines at the top, and the body after it. Plain, quoted and folded (`>` or `|`) values are read; nothing else of
 * YAML is needed here. Null when there is no front matter.
 */
export function parseFrontmatter(text: string): { fields: Record<string, string>; body: string } | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!match) return null;
  const fields: Record<string, string> = {};
  const lines = (match[1] ?? "").split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const field = /^([A-Za-z_-]+):\s*(.*)$/.exec(lines[i] ?? "");
    if (!field) continue;
    let value = field[2]?.trim() ?? "";
    if (value === ">" || value === "|" || value === ">-" || value === "|-") {
      const block: string[] = [];
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1] ?? "")) block.push((lines[++i] ?? "").trim());
      value = block.join(" ");
    }
    fields[field[1] ?? ""] = value.replace(/^(["'])(.*)\1$/, "$2");
  }
  return { fields, body: text.slice(match[0].length).trim() };
}

/** A comma-separated front matter list (`tools: Read, Grep`), trimmed, empty entries dropped. */
export function listField(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
