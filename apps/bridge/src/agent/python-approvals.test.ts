import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Message } from "@hai/protocol";
import { describe, expect, it } from "vitest";
import { ApprovalBroker, approvalsFile, readAlwaysAllowed, readApprovedPackages } from "./approvals.ts";

const PYTHON = "mcp__hai__python_run";
const RHINO = "mcp__hai__rhino_run_python";

function setup(installs: (tool: string, input: Record<string, unknown>) => string[]) {
  const projectDir = mkdtempSync(join(tmpdir(), "hai-pyapproval-"));
  const sent: Message[] = [];
  const broker = new ApprovalBroker({ projectDir: () => projectDir, pythonInstalls: installs }, (m) =>
    sent.push(m),
  );
  const cards = () => sent.filter((m) => m.type === "approval.pending");
  const lastCard = () =>
    cards().at(-1)?.payload as {
      id: string;
      tool: string;
      summary: string;
      installs?: string[];
      input: unknown;
    };
  const decide = (id: string, decision: "allow" | "deny" | "always") =>
    broker.handle({ type: "approval.decide", id: "d", payload: { id, decision } });
  return { broker, projectDir, sent, cards, lastCard, decide };
}

describe("Python approvals", () => {
  it("running Python waits for the user even though it is one of HAI's own tools, and the card carries the script", async () => {
    const t = setup(() => []);
    const input = { code: "print(1)", title: "Say one", packages: [] };
    const decision = t.broker.decide(PYTHON, input);
    expect(t.cards()).toHaveLength(1);
    expect(t.lastCard()).toMatchObject({ tool: PYTHON, summary: "Say one", input });
    t.decide(t.lastCard().id, "allow");
    expect(await decision).toEqual({ behavior: "allow", updatedInput: input });
  });

  it("a new library: the card lists what would be installed, first use and the library the script asks for", async () => {
    const t = setup((_tool, input) => [
      "rhino3dm",
      "ladybug-core",
      "numpy",
      ...((input.packages as string[]) ?? []),
    ]);
    const decision = t.broker.decide(PYTHON, {
      code: "import shapely",
      title: "Shapes",
      packages: ["shapely"],
    });
    expect(t.lastCard().installs).toEqual(["rhino3dm", "ladybug-core", "numpy", "shapely"]);
    expect(t.lastCard().summary).toBe("Shapes");
    t.decide(t.lastCard().id, "allow");
    await decision;
  });

  it("denied: the agent is told the user declined and nothing is remembered", async () => {
    const t = setup(() => ["shapely"]);
    const decision = t.broker.decide(PYTHON, { code: "x", title: "T", packages: ["shapely"] });
    t.decide(t.lastCard().id, "deny");
    expect(await decision).toEqual({ behavior: "deny", message: "The user declined this tool call." });
    expect(readAlwaysAllowed(t.projectDir)).toEqual([]);
    expect(readApprovedPackages(t.projectDir)).toEqual([]);
  });

  it("always allow does not cover a new package: a later run that adds one asks again", async () => {
    let wanted: string[] = ["numpy"];
    const t = setup(() => wanted);
    const first = t.broker.decide(PYTHON, { code: "1", title: "First", packages: [] });
    t.decide(t.lastCard().id, "always");
    await first;
    expect(readAlwaysAllowed(t.projectDir)).toEqual([PYTHON]);
    expect(readApprovedPackages(t.projectDir)).toEqual(["numpy"]);

    // The same packages again: no card.
    const cardsBefore = t.cards().length;
    expect(await t.broker.decide(PYTHON, { code: "2", title: "Second", packages: [] })).toMatchObject({
      behavior: "allow",
    });
    expect(t.cards()).toHaveLength(cardsBefore);

    // A package the user has not seen: a card, though the tool is always allowed.
    wanted = ["numpy", "shapely"];
    const third = t.broker.decide(PYTHON, { code: "3", title: "Third", packages: ["shapely"] });
    expect(t.cards()).toHaveLength(cardsBefore + 1);
    expect(t.lastCard().installs).toEqual(["numpy", "shapely"]);
    t.decide(t.lastCard().id, "allow");
    await third;
    // Allowing once does not add it to the approved list.
    expect(readApprovedPackages(t.projectDir)).toEqual(["numpy"]);
  });

  it("package names are compared as pip compares them", async () => {
    let wanted = ["Ladybug_Core"];
    const t = setup(() => wanted);
    const first = t.broker.decide(PYTHON, { code: "1", title: "A", packages: [] });
    t.decide(t.lastCard().id, "always");
    await first;
    wanted = ["ladybug-core==1.2"];
    const cardsBefore = t.cards().length;
    expect(await t.broker.decide(PYTHON, { code: "2", title: "B", packages: [] })).toMatchObject({
      behavior: "allow",
    });
    expect(t.cards()).toHaveLength(cardsBefore);
  });

  it("Rhino runs are code too: they ask, list their requirement lines, and the scene tools still do not", async () => {
    const t = setup((tool, input) =>
      tool === RHINO ? [...String(input.code).matchAll(/# r: (\S+)/g)].map((m) => m[1] as string) : [],
    );
    const decision = t.broker.decide(RHINO, {
      code: "# r: ladybug-core\nimport Rhino",
      title: "Sun",
      timeoutSeconds: 60,
    });
    expect(t.lastCard()).toMatchObject({ tool: RHINO, installs: ["ladybug-core"] });
    t.decide(t.lastCard().id, "allow");
    await decision;
    const before = t.cards().length;
    expect(await t.broker.decide("mcp__hai__update_elements", { updates: [] })).toMatchObject({
      behavior: "allow",
    });
    expect(await t.broker.decide("mcp__hai__rhino_get_document", {})).toMatchObject({ behavior: "allow" });
    expect(t.cards()).toHaveLength(before);
  });

  it("an unanswered code card is denied, like any other", async () => {
    const t = setup(() => []);
    const quick = new ApprovalBroker(
      { projectDir: () => t.projectDir, timeoutMs: 20, pythonInstalls: () => [] },
      () => {},
    );
    expect(await quick.decide(PYTHON, { code: "1", title: "T" })).toMatchObject({ behavior: "deny" });
  });

  it("the approved packages are kept beside the always-allowed tools, and revoking a tool keeps them", async () => {
    const t = setup(() => ["numpy"]);
    const first = t.broker.decide(PYTHON, { code: "1", title: "A", packages: [] });
    t.decide(t.lastCard().id, "always");
    await first;
    t.broker.handle({ type: "approvals.revoke", id: "r", payload: { tool: PYTHON } });
    const file = JSON.parse(readFileSync(approvalsFile(t.projectDir), "utf8"));
    expect(file).toEqual({ alwaysAllow: [], pythonPackages: ["numpy"] });
    // Revoked: it asks again.
    const again = t.broker.decide(PYTHON, { code: "2", title: "B", packages: [] });
    expect(t.cards()).toHaveLength(2);
    t.decide(t.lastCard().id, "deny");
    await again;
  });
});
