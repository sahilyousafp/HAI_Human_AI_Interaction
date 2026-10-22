import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { fakeProvider } from "../apps/bridge/test/fake-provider.ts";
import { closeSettings, openSettings } from "./settings.ts";
import { openViewer, startTestBridge } from "./viewer.ts";

type Bridge = Awaited<ReturnType<typeof startTestBridge>>;
type ToolResult = { content: Array<{ type: string; text?: string; data?: string; mimeType?: string }> };

/** Calls one of the bridge's MCP tools the way an agent does: a JSON-RPC request with a token issued to it. */
async function callTool(bridge: Bridge, name: string): Promise<ToolResult & { isError?: boolean }> {
  const token = bridge.agentTokens.issue({ agent: "reviewer", tools: new Set([name]) });
  const res = await fetch(`http://127.0.0.1:${bridge.port}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: {} } }),
  });
  expect(res.status).toBe(200);
  const body = await res.text();
  // Streamable HTTP may answer as an event stream: the JSON-RPC response is the last data line.
  const json = res.headers.get("content-type")?.includes("text/event-stream")
    ? (body
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .at(-1)
        ?.slice(5) ?? "null")
    : body;
  return JSON.parse(json).result;
}

/** Width and height from a PNG's IHDR chunk. */
function pngSize(base64: string): [number, number] {
  const bytes = Buffer.from(base64, "base64");
  expect(bytes.subarray(1, 4).toString("ascii")).toBe("PNG");
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

/** A private bridge whose agent is the fake Claude Code CLI (apps/bridge/test/fake-claude.mjs), and the viewer. */
async function startWithFakeAgent(page: Page, detection?: Parameters<typeof fakeProvider>[1]) {
  const bridge = await startTestBridge(page, {
    agent: fakeProvider(mkdtempSync(join(tmpdir(), "hai-e2e-fake-")), detection),
  });
  await openViewer(page);
  return bridge;
}

const panel = (page: Page) => page.getByTestId("agent-panel");
const status = (page: Page) => page.getByTestId("agent-status");
const lastTurn = (page: Page) => page.getByTestId("agent-turn").last();

async function ask(page: Page, text: string) {
  await expect(status(page)).toHaveAttribute("data-state", "idle");
  await page.getByTestId("agent-input").fill(text);
  await page.getByTestId("agent-input").press("Enter");
}

const inject = (page: Page, type: string) =>
  page.evaluate((t) => window.__HAI_INPUT__?.gestures([{ type: t, ts: Date.now(), confidence: 1 }]), type);

test.describe("agent sees the view", () => {
  test("capture view: the agent receives a PNG of the current view, at most 1280 px", async ({ page }) => {
    const bridge = await startTestBridge(page);
    try {
      await page.setViewportSize({ width: 1920, height: 1080 });
      await openViewer(page);
      const result = await callTool(bridge, "capture_view");
      const image = result.content[0];
      expect(image?.type).toBe("image");
      expect(image?.mimeType).toBe("image/png");
      const [width, height] = pngSize(image?.data ?? "");
      expect(Math.max(width, height)).toBeLessThanOrEqual(1280);
      expect(Math.min(width, height)).toBeGreaterThan(200);
      // A rendered model, not an empty canvas (a blank PNG of this size compresses to a few kilobytes).
      expect(Buffer.from(image?.data ?? "", "base64").length).toBeGreaterThan(50_000);
    } finally {
      await bridge.stop();
    }
  });

  test("no viewer open: the agent is told so", async ({ page }) => {
    const bridge = await startTestBridge(page);
    try {
      const result = await callTool(bridge, "capture_view");
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toMatch(/no viewer is open/i);
    } finally {
      await bridge.stop();
    }
  });

  test("the agent can read what the hand points at and how the camera looks", async ({ page }) => {
    const bridge = await startTestBridge(page);
    try {
      await openViewer(page);
      await expect
        .poll(async () => JSON.parse((await callTool(bridge, "get_user_context")).content[0]?.text ?? "{}"))
        .toMatchObject({ camera: { azimuth: expect.any(Number), distance: expect.any(Number) } });
      const context = JSON.parse((await callTool(bridge, "get_user_context")).content[0]?.text ?? "{}");
      // Millimetres, like the scene: the framed sample model is tens of metres away.
      expect(context.camera.distance).toBeGreaterThan(10_000);
    } finally {
      await bridge.stop();
    }
  });
});

test.describe("agent panel", () => {
  test("send typed request: Enter puts the request in the transcript and starts a turn", async ({ page }) => {
    const bridge = await startWithFakeAgent(page);
    try {
      await ask(page, "hello there");
      await expect(lastTurn(page).locator(".agent-request")).toHaveText("hello there");
      await expect(lastTurn(page)).toHaveAttribute("data-ended", "done");
      await expect(lastTurn(page).getByTestId("agent-text")).toContainText("previous=none");
      await expect(page.getByTestId("agent-input")).toHaveValue("");
    } finally {
      await bridge.stop();
    }
  });

  test("streaming reply: text appears in several increments before the turn is complete", async ({
    page,
  }) => {
    const bridge = await startWithFakeAgent(page);
    try {
      // Record every distinct reply text, and whether the turn had ended when it was seen.
      await page.evaluate(() => {
        const seen: Array<{ text: string; ended: string | null }> = [];
        (window as unknown as { __seen: typeof seen }).__seen = seen;
        new MutationObserver(() => {
          const turns = document.querySelectorAll("[data-testid=agent-turn]");
          const last = turns[turns.length - 1];
          const text = last?.querySelector("[data-testid=agent-text]")?.textContent ?? "";
          if (text && text !== seen.at(-1)?.text)
            seen.push({ text, ended: last?.getAttribute("data-ended") ?? null });
        }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
      });
      await ask(page, "stream");
      await expect(lastTurn(page)).toHaveAttribute("data-ended", "done");
      const seen = await page.evaluate(
        () => (window as unknown as { __seen: Array<{ text: string; ended: string | null }> }).__seen,
      );
      expect(seen.filter((s) => s.ended === "running").length).toBeGreaterThanOrEqual(3);
      expect(seen.at(-1)?.text).toBe("Three floors of 3.5 m added.");
    } finally {
      await bridge.stop();
    }
  });

  test("working status: shows working until the turn completes", async ({ page }) => {
    const bridge = await startWithFakeAgent(page);
    try {
      await ask(page, "stream");
      await expect(status(page)).toHaveAttribute("data-state", "working");
      await expect(page.getByTestId("agent-stop")).toBeVisible();
      await expect(status(page)).toHaveAttribute("data-state", "idle");
      await expect(page.getByTestId("agent-send")).toBeVisible();
    } finally {
      await bridge.stop();
    }
  });

  test("failed tool call: the chip shows failed and expanding it shows the error", async ({ page }) => {
    const bridge = await startWithFakeAgent(page);
    try {
      await ask(page, "delegate architect: bad column");
      await lastTurn(page).getByTestId("handoff-chip").click();
      const chip = page.getByTestId("task-transcript").getByTestId("tool-chip");
      await expect(chip.getByTestId("tool-chip-agent")).toHaveText("Architect");
      await expect(chip).toHaveAttribute("data-outcome", "failed");
      await expect(chip).toContainText("create_elements");
      await expect(chip.getByTestId("tool-chip-result")).toBeHidden();
      await chip.locator("summary").click();
      await expect(chip.getByTestId("tool-chip-result")).toContainText("height");
    } finally {
      await bridge.stop();
    }
  });

  test("stop button: the turn stops within 3 seconds and a new request is accepted", async ({ page }) => {
    const bridge = await startWithFakeAgent(page);
    try {
      await ask(page, "slow");
      await expect(status(page)).toHaveAttribute("data-state", "working");
      const started = Date.now();
      await page.getByTestId("agent-stop").click();
      await expect(lastTurn(page)).toHaveAttribute("data-ended", "stopped");
      expect(Date.now() - started).toBeLessThan(3000);
      await ask(page, "after the stop");
      await expect(lastTurn(page)).toHaveAttribute("data-ended", "done");
    } finally {
      await bridge.stop();
    }
  });

  test("stop gesture: both fists, then open hands, stop the running turn", async ({ page }) => {
    const bridge = await startWithFakeAgent(page);
    try {
      await ask(page, "slow");
      await expect(status(page)).toHaveAttribute("data-state", "working");
      await page.evaluate(() => window.__HAI_INPUT__?.engaged(true));
      await inject(page, "hands.stop");
      await expect(lastTurn(page)).toHaveAttribute("data-ended", "stopped", { timeout: 3000 });
    } finally {
      await bridge.stop();
    }
  });

  test("CLI missing: the panel says so and how to fix it, and nothing can be sent", async ({ page }) => {
    const bridge = await startWithFakeAgent(page, {
      ok: false,
      reason: "missing",
      message: "Claude Code is not installed.",
      fix: "Install it from https://code.claude.com, then reload.",
    });
    try {
      await expect(status(page)).toHaveAttribute("data-state", "unavailable");
      await expect(page.getByTestId("agent-unavailable")).toContainText("Claude Code is not installed.");
      await expect(page.getByTestId("agent-input")).toBeDisabled();
    } finally {
      await bridge.stop();
    }
  });

  test("Ask agent in the palette opens the panel and listens, leaving the keyboard focus alone", async ({
    page,
  }) => {
    const bridge = await startWithFakeAgent(page);
    try {
      await expect(status(page)).toHaveAttribute("data-state", "idle");
      await panel(page).getByRole("button", { name: "Hide the agent panel" }).click();
      await page.locator("body").click({ position: { x: 5, y: 5 } }); // focus away from the panel
      await page.keyboard.press("a");
      await expect(panel(page)).toHaveAttribute("data-collapsed", "false");
      await expect(page.getByTestId("mic-indicator")).toHaveAttribute("data-state", "on");
      await expect(page.getByTestId("agent-input")).not.toBeFocused();
      await expect(page.getByTestId("active-tool")).toHaveAttribute("data-tool", "select");
      await page.getByTestId("mic-button").click(); // stop listening
    } finally {
      await bridge.stop();
    }
  });

  test("collapses to its header and stays collapsed after a reload", async ({ page }) => {
    const bridge = await startWithFakeAgent(page);
    try {
      await panel(page).getByRole("button", { name: "Hide the agent panel" }).click();
      await expect(panel(page)).toHaveAttribute("data-collapsed", "true");
      await expect(page.getByTestId("agent-transcript")).toBeHidden();
      await page.reload();
      await expect(panel(page)).toHaveAttribute("data-collapsed", "true");
      await panel(page).getByRole("button", { name: "Show the agent panel" }).click();
      await expect(page.getByTestId("agent-transcript")).toBeVisible();
    } finally {
      await bridge.stop();
    }
  });
});

test.describe("the team", () => {
  const chip = (page: Page, agent: string) => page.getByTestId(`team-chip-${agent}`);

  test("team strip follows the work: Architect working on its task, Product queued behind it", async ({
    page,
  }) => {
    const bridge = await startWithFakeAgent(page);
    try {
      await ask(page, "delegate architect: work 2500 | product: work 200");
      await expect(page.getByTestId("agent-title")).toHaveText("Mochi");
      await expect(chip(page, "architect")).toHaveAttribute("data-state", "working");
      await expect(chip(page, "architect")).toContainText("work 2500");
      await expect(chip(page, "product")).toHaveAttribute("data-state", "queued");
      await expect(chip(page, "reviewer")).toHaveAttribute("data-state", "idle");
      // Mochi is free while they work.
      await expect(status(page)).toHaveAttribute("data-state", "idle");
      await expect(page.getByTestId("team-stop")).toBeVisible();
      // Both finish, Product after Architect, and Mochi reports.
      await expect(chip(page, "product")).toHaveAttribute("data-state", "idle", { timeout: 8000 });
      await expect(lastTurn(page)).toHaveAttribute("data-kind", "digest");
      await expect(lastTurn(page)).toContainText('Architect "work 2500": done');
      await expect(page.getByTestId("team-stop")).toBeHidden();
    } finally {
      await bridge.stop();
    }
  });

  test("hand-off opens the specialist's conversation: Architect's task with its tool calls", async ({
    page,
  }) => {
    const bridge = await startWithFakeAgent(page);
    try {
      await ask(page, "delegate architect: columns 2");
      const handOff = page.getByTestId("handoff-chip");
      await expect(handOff).toContainText("Architect");
      await expect(handOff).toHaveAttribute("data-status", "done", { timeout: 8000 });
      await handOff.click();
      await expect(page.getByTestId("task-thread")).toContainText("Architect");
      await expect(page.getByTestId("task-status")).toHaveText("done");
      const chips = page.getByTestId("task-transcript").getByTestId("tool-chip");
      await expect(chips).toHaveCount(2);
      await expect(chips.first().getByTestId("tool-chip-agent")).toHaveText("Architect");
      await expect(page.getByTestId("task-transcript")).toContainText("Added 2 columns.");
      await page.getByTestId("task-back").click();
      await expect(page.getByTestId("agent-transcript")).toBeVisible();
    } finally {
      await bridge.stop();
    }
  });

  test("stop one task by click: Architect stops within 3 s while Climate keeps working", async ({ page }) => {
    const bridge = await startWithFakeAgent(page);
    try {
      await ask(page, "delegate architect: work 8000 | climate: work 4000");
      await expect(chip(page, "climate")).toHaveAttribute("data-state", "working");
      await chip(page, "architect").click();
      const started = Date.now();
      await page.getByTestId("task-stop").click();
      await expect(page.getByTestId("task-status")).toHaveText("stopped", { timeout: 3000 });
      expect(Date.now() - started).toBeLessThan(3000);
      await expect(chip(page, "climate")).toHaveAttribute("data-state", "working");
    } finally {
      await bridge.stop();
    }
  });

  test("a specialist's approval card names it and waits in Mochi's chat; a nod allows it", async ({
    page,
  }) => {
    const bridge = await startWithFakeAgent(page);
    try {
      await ask(page, "delegate architect: shell: echo team");
      const card = page.getByTestId("approval-card");
      await expect(card).toBeVisible();
      await expect(card.getByTestId("approval-agent")).toHaveText("Architect");
      await expect(chip(page, "architect")).toHaveAttribute("data-state", "waiting");
      await page.evaluate(() => window.__HAI_INPUT__?.engaged(true));
      await inject(page, "head.nod");
      await expect(page.getByTestId("handoff-chip")).toHaveAttribute("data-status", "done");
      await expect(lastTurn(page)).toContainText("Done: ran: echo team");
    } finally {
      await bridge.stop();
    }
  });
});

test.describe("climate's sun study", () => {
  test("winter shadows: Climate sets the viewer's sun low in the south, and Escape restores the light", async ({
    page,
  }) => {
    const bridge = await startWithFakeAgent(page);
    try {
      await ask(page, "Climate, winter shadows");
      const badge = page.getByTestId("sun-study");
      await expect(badge).toContainText("Sun study 2026-12-21 12:00, 51.5 N 0 E");
      await expect(badge).toContainText(/15° up, 180° from north/);
      const sun = await page.evaluate(() => window.__HAI_VIEWER__?.sun());
      expect(sun?.altitude).toBeCloseTo(15.2, 0);
      expect(sun?.azimuth).toBeCloseTo(180, 0);
      await expect(page.getByTestId("handoff-chip")).toHaveAttribute("data-status", "done");
      await page.getByTestId("handoff-chip").click();
      await expect(page.getByTestId("task-transcript")).toContainText(/Sun at 15\.\d degrees from the S\./);
      await page.keyboard.press("Escape");
      await expect(badge).toHaveCount(0);
      expect(await page.evaluate(() => window.__HAI_VIEWER__?.sun())).toBeNull();
    } finally {
      await bridge.stop();
    }
  });
});

test.describe("addressing by name", () => {
  test("a typed specialist name: Mochi hands the request to Architect, without the name", async ({
    page,
  }) => {
    const bridge = await startWithFakeAgent(page);
    try {
      await ask(page, "Architect, work 100");
      await expect(lastTurn(page).locator(".agent-request")).toHaveText("work 100");
      const handOff = page.getByTestId("handoff-chip");
      await expect(handOff).toContainText("Architect");
      await expect(handOff).toHaveAttribute("data-status", "done");
    } finally {
      await bridge.stop();
    }
  });

  test("Mochi asked to delegate: 'Mochi, ask Climate to ...' reaches Climate", async ({ page }) => {
    const bridge = await startWithFakeAgent(page);
    try {
      await ask(page, "Machi, ask Climate to work 100");
      await expect(lastTurn(page).locator(".agent-request")).toHaveText("ask Climate to work 100");
      await expect(lastTurn(page).getByTestId("handoff-chip")).toContainText("Climate");
    } finally {
      await bridge.stop();
    }
  });
});

test.describe("agents tab", () => {
  test("lists the team, adds an agent that Mochi can then hand work to, and edits one", async ({ page }) => {
    const bridge = await startWithFakeAgent(page);
    try {
      await ask(page, "hello"); // the first request creates the team
      await expect(lastTurn(page)).toHaveAttribute("data-ended", "done");
      await page.getByTestId("agent-tab-agents").click();
      const definitions = page.getByTestId("agent-definition");
      await expect(definitions).toHaveCount(5);
      await expect(definitions.first()).toContainText("Mochi");
      await expect(definitions.first()).toContainText("lead");

      await page.getByTestId("agent-add").click();
      await page.getByTestId("agent-name").fill("structure");
      await page.getByTestId("agent-description").fill("Sizes beams and columns.");
      await page.getByTestId("agent-can-write").check();
      await page.getByTestId("agent-prompt").fill("You are Structure.");
      await page.getByTestId("agent-save").click();
      await expect(page.getByTestId("agents-result")).toHaveText(
        "Saved Structure. It applies from its next task.",
      );
      await expect(definitions).toHaveCount(6);
      await expect(definitions.filter({ hasText: "Structure" })).toContainText("changes the model");

      // Edit Architect's description.
      await page.getByRole("button", { name: "Edit Architect" }).click();
      await expect(page.getByTestId("agent-name")).toBeDisabled();
      await page.getByTestId("agent-description").fill("Only cores and stairs.");
      await page.getByTestId("agent-save").click();
      await expect(definitions.filter({ hasText: "Architect" })).toContainText("Only cores and stairs.");

      // Mochi can hand work to the new agent.
      await page.getByTestId("agent-tab-chat").click();
      await ask(page, "delegate structure: work 100");
      await expect(page.getByTestId("handoff-chip")).toHaveAttribute("data-status", "done");
      await expect(page.getByTestId("team-chip-structure")).toBeVisible();
    } finally {
      await bridge.stop();
    }
  });

  test("a name already in the team is refused before saving", async ({ page }) => {
    const bridge = await startWithFakeAgent(page);
    try {
      await ask(page, "hello");
      await page.getByTestId("agent-tab-agents").click();
      await page.getByTestId("agent-add").click();
      await page.getByTestId("agent-name").fill("climate");
      await expect(page.getByTestId("agent-form").getByRole("alert")).toHaveText(
        "There is already an agent with this name.",
      );
      await expect(page.getByTestId("agent-save")).toBeDisabled();
    } finally {
      await bridge.stop();
    }
  });
});

test.describe("tool approval", () => {
  test("nod allows: the only pending card is allowed and the command runs", async ({ page }) => {
    const bridge = await startWithFakeAgent(page);
    try {
      await ask(page, "shell: echo hi");
      const card = page.getByTestId("approval-card");
      await expect(card).toHaveAttribute("data-outcome", "pending");
      await expect(card.getByTestId("approval-summary")).toHaveText("echo hi");
      await expect(card).toContainText("Nod to allow, shake to deny");
      await page.evaluate(() => window.__HAI_INPUT__?.engaged(true));
      await inject(page, "head.nod");
      await expect(card.getByTestId("approval-outcome")).toHaveText("Allowed");
      await expect(lastTurn(page).getByTestId("agent-text")).toHaveText("Done: ran: echo hi");
    } finally {
      await bridge.stop();
    }
  });

  test("shake denies: the call is denied, the agent is told, and the tool is not cancelled", async ({
    page,
  }) => {
    const bridge = await startWithFakeAgent(page);
    try {
      await page.keyboard.press("d"); // measure: a shake would normally cancel it
      await ask(page, "shell: rm -rf build");
      const card = page.getByTestId("approval-card");
      await expect(card).toHaveAttribute("data-outcome", "pending");
      await inject(page, "head.shake");
      await expect(card.getByTestId("approval-outcome")).toHaveText("Denied");
      await expect(lastTurn(page).getByTestId("tool-chip")).toHaveAttribute("data-outcome", "denied");
      await expect(lastTurn(page).getByTestId("agent-text")).toHaveText(
        "I did not run it: The user declined this tool call.",
      );
      await expect(page.getByTestId("active-tool")).toHaveAttribute("data-tool", "measure");
    } finally {
      await bridge.stop();
    }
  });

  test("always allow is remembered for the project and can be revoked in settings", async ({ page }) => {
    const bridge = await startWithFakeAgent(page);
    try {
      await ask(page, "shell: ls");
      await page.getByTestId("approval-card").getByRole("button", { name: "Always allow" }).click();
      await expect(lastTurn(page)).toHaveAttribute("data-ended", "done");
      await openSettings(page, "permissions");
      await expect(page.getByTestId("allowed-tool")).toContainText("Bash");
      await closeSettings(page);

      await ask(page, "shell: ls again");
      await expect(lastTurn(page)).toHaveAttribute("data-ended", "done");
      await expect(lastTurn(page).getByTestId("approval-card")).toHaveCount(0);

      await openSettings(page, "permissions");
      await page
        .getByTestId("allowed-tool")
        .getByRole("button", { name: /Stop always allowing/ })
        .click();
      await expect(page.getByTestId("allowed-tool")).toHaveCount(0);
      await closeSettings(page);
      await ask(page, "shell: ls once more");
      await expect(lastTurn(page).getByTestId("approval-card")).toHaveAttribute("data-outcome", "pending");
    } finally {
      await bridge.stop();
    }
  });
});

test.describe("extensions", () => {
  test("shows loaded servers with a failed one, adds servers with masked secrets, installs skills", async ({
    page,
  }) => {
    const bridge = await startWithFakeAgent(page);
    try {
      const projectDir = bridge.scene.projectDir ?? "";
      writeFileSync(
        join(projectDir, ".mcp.json"),
        JSON.stringify({
          mcpServers: { "broken-db": { type: "stdio", command: "nope", args: [], env: {} } },
        }),
      );
      await page.getByTestId("agent-tab-extensions").click();
      const view = page.getByTestId("extensions-view");
      await expect(view).toContainText("Shown once the agent has started");

      // The session's init event lists what loaded, including the failed project server.
      await page.getByTestId("agent-tab-chat").click();
      await ask(page, "hello");
      await expect(lastTurn(page)).toHaveAttribute("data-ended", "done");
      await page.getByTestId("agent-tab-extensions").click();
      await expect(view.getByTestId("loaded-server").filter({ hasText: "broken-db" })).toHaveAttribute(
        "data-status",
        "failed",
      );

      // Add a stdio server through the form.
      await view.getByText("Add a server").click();
      await view.getByTestId("server-name").fill("files");
      await view.getByTestId("server-command").fill("npx");
      await view.getByTestId("server-args").fill("-y\nfiles-mcp");
      await view.getByTestId("add-server").click();
      await expect(view.getByTestId("extensions-result")).toContainText("Added the MCP server files");
      await expect(view.getByTestId("project-server").filter({ hasText: "files" })).toContainText(
        "npx -y files-mcp",
      );

      // An HTTP server with a secret header: only the header name is ever shown.
      const secret = "Bearer sk-live-e2e-secret-777";
      await view.getByLabel("URL (HTTP)").check();
      await view.getByTestId("server-name").fill("tracker");
      await view.getByTestId("server-url").fill("https://mcp.example.com/mcp");
      await view.getByRole("button", { name: "Add header" }).click();
      await view.getByLabel("Header 1", { exact: true }).fill("Authorization");
      await view.getByLabel("Value 1 (hidden)").fill(secret);
      await expect(view.getByLabel("Value 1 (hidden)")).toHaveAttribute("type", "password");
      await view.getByTestId("add-server").click();
      await expect(view.getByTestId("extensions-result")).toContainText("Added the MCP server tracker");
      await expect(
        view.getByTestId("project-server").filter({ hasText: "tracker" }).getByTestId("masked-secret"),
      ).toHaveText("Authorization: ••••••");
      expect(await page.content()).not.toContain("sk-live-e2e-secret");

      // Skills: a folder without SKILL.md is refused; a valid one is installed.
      const empty = mkdtempSync(join(tmpdir(), "hai-e2e-skill-"));
      await view.getByTestId("skill-source").fill(empty);
      await view.getByTestId("install-skill").click();
      await expect(view.getByTestId("extensions-result")).toContainText("SKILL.md is missing");
      writeFileSync(join(empty, "SKILL.md"), "---\nname: zoning-check\ndescription: Checks massing.\n---\n");
      await view.getByTestId("skill-source").fill(empty);
      await view.getByTestId("install-skill").click();
      await expect(view.getByTestId("project-skill")).toContainText("zoning-check");

      // Removing a server takes it out of the project again.
      await view.getByRole("button", { name: "Remove the MCP server files" }).click();
      await expect(view.getByTestId("project-server").filter({ hasText: "files" })).toHaveCount(0);
    } finally {
      await bridge.stop();
    }
  });
});
