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
    const root = mkdtempSync(join(tmpdir(), "aex-boundary-"));
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
});
