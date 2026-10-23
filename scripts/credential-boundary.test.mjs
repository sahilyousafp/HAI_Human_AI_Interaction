import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findViolations } from "./credential-boundary.mjs";

describe("credential boundary", () => {
  it("no credential access in code: no shipped source references Claude credentials", () => {
    expect(findViolations(join(import.meta.dirname, ".."))).toEqual([]);
  });

  it("catches a reference in shipped code, and ignores tests", () => {
    const root = mkdtempSync(join(tmpdir(), "hai-boundary-"));
    mkdirSync(join(root, "apps", "bridge", "src"), { recursive: true });
    mkdirSync(join(root, "apps", "bridge", "test"), { recursive: true });
    writeFileSync(
      join(root, "apps", "bridge", "src", "leak.ts"),
      'const home = "x";\nreadFileSync(home + "/.claude/.credentials.json");\n',
    );
    writeFileSync(join(root, "apps", "bridge", "src", "ok.test.ts"), "process.env.ANTHROPIC_API_KEY;\n");
    writeFileSync(
      join(root, "apps", "bridge", "test", "helper.ts"),
      "process.env.CLAUDE_CODE_OAUTH_TOKEN;\n",
    );
    expect(findViolations(root)).toEqual([
      { file: join("apps", "bridge", "src", "leak.ts"), line: 2, what: "Claude's credential file" },
    ]);
  });

  it("covers the desktop app: its setup, main process and build scripts are shipped code", () => {
    const root = mkdtempSync(join(tmpdir(), "hai-boundary-desktop-"));
    for (const dir of ["src", join("src", "setup"), "scripts"]) {
      mkdirSync(join(root, "apps", "desktop", dir), { recursive: true });
    }
    // The first-run screen learns the sign-in result from `claude auth status` only; reading the login is a leak.
    writeFileSync(
      join(root, "apps", "desktop", "src", "setup", "signin.ts"),
      'const login = readFileSync(join(home, ".claude", ".credentials.json"));\n',
    );
    writeFileSync(
      join(root, "apps", "desktop", "src", "main.ts"),
      "const key = process.env.ANTHROPIC_API_KEY;\n",
    );
    writeFileSync(
      join(root, "apps", "desktop", "scripts", "dev.ts"),
      "const t = process.env.CLAUDE_CODE_OAUTH_TOKEN;\n",
    );
    const files = findViolations(root).map((v) => v.file);
    expect(files.sort()).toEqual(
      [
        join("apps", "desktop", "scripts", "dev.ts"),
        join("apps", "desktop", "src", "main.ts"),
        join("apps", "desktop", "src", "setup", "signin.ts"),
      ].sort(),
    );
  });
});
