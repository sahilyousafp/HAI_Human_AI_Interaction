import { existsSync, readdirSync, readFileSync, renameSync, rmdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** What the project's files and tools were called while the project was still named AEX. */
const OLD = { dir: ".aex", scene: "scene.aex.json", asset: ".aexmesh", tools: "mcp__aex__" };
const NEW = { dir: ".hai", scene: "scene.hai.json", asset: ".haimesh", tools: "mcp__hai__" };

/** Renames a file or folder to its new name, unless it is not there or the new name is already taken. */
function rename(from: string, to: string): void {
  if (existsSync(from) && !existsSync(to)) renameSync(from, to);
}

/**
 * Moves the old folder to the new name. If the new folder already exists (a test run or a first start made it before
 * the old one was looked at), what is in the old one moves in entry by entry, and anything the new one already has
 * stays where it is, in the old folder.
 */
function moveFolder(from: string, to: string): void {
  if (!existsSync(from)) return;
  if (!existsSync(to)) {
    renameSync(from, to);
    return;
  }
  for (const entry of readdirSync(from)) rename(join(from, entry), join(to, entry));
  if (readdirSync(from).length === 0) rmdirSync(from);
}

/** The app's own MCP server was called `aex`, so tool names saved by an older version start with `mcp__aex__`. */
function renameToolNames(file: string): void {
  if (!existsSync(file)) return;
  const text = readFileSync(file, "utf8");
  if (text.includes(OLD.tools)) writeFileSync(file, text.replaceAll(OLD.tools, NEW.tools));
}

/**
 * A folder the app keeps data in (the workspace, or a project) may hold what an older version, named AEX, saved there:
 * the `.aex` folder (settings, sessions, the always-allowed tools, the team) becomes `.hai`, and tool names saved in it
 * and in the project's agent files follow the app's tool server to its new name. Nothing already named the new way is
 * overwritten (an old file whose new name is taken stays where it is), and a folder with nothing old in it is left alone.
 */
export function migrateLegacyFolder(dir: string): void {
  moveFolder(join(dir, OLD.dir), join(dir, NEW.dir));
  const data = join(dir, NEW.dir);
  renameToolNames(join(data, "approvals.json"));
  renameToolNames(join(data, "agents.json"));
  const agents = join(dir, ".claude", "agents");
  if (existsSync(agents))
    for (const file of readdirSync(agents)) if (file.endsWith(".md")) renameToolNames(join(agents, file));
}

/** A project folder: as `migrateLegacyFolder`, and its scene file and imported-model assets take their new names. */
export function migrateLegacyProject(dir: string): void {
  migrateLegacyFolder(dir);
  rename(join(dir, OLD.scene), join(dir, NEW.scene));
  const assets = join(dir, "assets");
  if (existsSync(assets))
    for (const file of readdirSync(assets))
      if (file.endsWith(OLD.asset))
        rename(join(assets, file), join(assets, `${file.slice(0, -OLD.asset.length)}${NEW.asset}`));
}
