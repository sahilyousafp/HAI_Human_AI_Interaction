// The credential boundary, checked in CI: no shipped source may reference Claude's credential files or token
// variables. The app drives the user's own `claude` CLI and must never read, copy or forward its login.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";

/** What must never appear outside tests: Claude's credential store and the variables that carry a key or token. */
export const FORBIDDEN = [
  { pattern: /\.credentials\.json/, what: "Claude's credential file" },
  { pattern: /CLAUDE_CODE_OAUTH_TOKEN/, what: "the Claude Code OAuth token variable" },
  { pattern: /ANTHROPIC_API_KEY/, what: "the Anthropic API key variable" },
  { pattern: /ANTHROPIC_AUTH_TOKEN/, what: "the Anthropic auth token variable" },
  { pattern: /oauthAccount|claudeAiOauth/, what: "a field of Claude's stored login" },
];

const SOURCE = /\.(ts|tsx|js|mjs|cjs|cs)$/;
const SKIPPED_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  "test",
  "tests",
  "fixtures",
  "test-assets",
  ".aex",
]);
const SKIPPED_FILES = /\.test\.|[\\/]credential-boundary\.mjs$/;

function* sourceFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRS.has(entry.name) && !entry.name.startsWith("."))
        yield* sourceFiles(join(dir, entry.name));
    } else if (SOURCE.test(entry.name)) {
      const path = join(dir, entry.name);
      if (!SKIPPED_FILES.test(path)) yield path;
    }
  }
}

/** Every reference to a forbidden name in the shipped sources under `root`'s apps, packages, plugins and scripts. */
export function findViolations(root, dirs = ["apps", "packages", "plugins", "scripts"]) {
  const found = [];
  for (const dir of dirs) {
    let files;
    try {
      files = [...sourceFiles(join(root, dir))];
    } catch {
      continue; // the folder does not exist (yet)
    }
    for (const file of files) {
      readFileSync(file, "utf8")
        .split(/\r?\n/)
        .forEach((text, i) => {
          for (const { pattern, what } of FORBIDDEN)
            if (pattern.test(text)) found.push({ file: relative(root, file), line: i + 1, what });
        });
    }
  }
  return found;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const violations = findViolations(join(import.meta.dirname, ".."));
  for (const v of violations) console.error(`${v.file}:${v.line} references ${v.what}`);
  if (violations.length > 0) {
    console.error(
      "The app must never touch Claude credentials. Remove these references (tests may use them).",
    );
    process.exit(1);
  }
  console.log("Credential boundary: no shipped source references Claude credentials.");
}
