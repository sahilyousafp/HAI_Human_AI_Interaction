import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Locator, type Page } from "@playwright/test";
import type { Team } from "../apps/bridge/src/agent/team.ts";
import type { Bridge } from "../apps/bridge/src/server.ts";
import { fakeProvider } from "../apps/bridge/test/fake-provider.ts";
import { openViewer, startTestBridge } from "./viewer.ts";

// Shared by the generated-panel specs: a private bridge whose agent is the fake Claude Code CLI, and the ways a user
// reaches a panel (Mochi hands the request to Architect, which offers the panel as it would for real).

let bridge: (Bridge & { port: number }) | null = null;
export async function stopBridge() {
  await bridge?.stop();
  bridge = null;
}

export async function start(page: Page) {
  bridge = await startTestBridge(page, {
    agent: fakeProvider(mkdtempSync(join(tmpdir(), "hai-e2e-panel-"))),
  });
  await openViewer(page);
  await page.evaluate(() => window.__HAI_INPUT__?.engaged(true));
  await expect(page.getByTestId("agent-status")).toHaveAttribute("data-state", "idle");
}

export function current() {
  if (!bridge) throw new Error("no bridge");
  return bridge;
}
export const team = () => current().agent as Team;

/** Asks Mochi, which hands the task "panel ..." to Architect; Architect then offers a panel. */
export async function askForPanel(html = "") {
  await team().request(`delegate architect: panel ${html}`.trim());
}

export const gesture = (page: Page, type: "head.nod" | "head.shake") =>
  page.evaluate((t) => window.__HAI_INPUT__?.gestures([{ type: t, ts: Date.now(), confidence: 1 }]), type);

export const offerCard = (page: Page) => page.getByTestId("offer-card").last();
export const shell = (page: Page) => page.getByTestId("generated-panel");
export const frame = (page: Page) => page.frameLocator('[data-testid="panel-frame"]');
export const sceneOf = (page: Page) =>
  page.evaluate(() => JSON.parse(JSON.stringify(window.__HAI_SCENE__?.getSnapshot().doc?.elements ?? {})));

/** Opens the default panel (a clearance slider) and waits until its content is on screen. */
export async function openClearancePanel(page: Page) {
  await askForPanel();
  await expect(offerCard(page)).toBeVisible();
  await page.getByTestId("offer-open").click();
  await expect(frame(page).locator("#s")).toBeVisible();
  await expect(shell(page)).toHaveAttribute("data-status", "ready");
}

/**
 * Has the architect offer a panel with this document, accepts it by pressing Open, and waits for the page to report
 * how the document loaded.
 */
export async function openCustomPanel(page: Page, html: string, status: "ready" | "failed" = "ready") {
  await askForPanel(html);
  await expect(offerCard(page)).toBeVisible();
  await page.getByTestId("offer-open").click();
  await expect(shell(page)).toHaveAttribute("data-status", status);
}

export async function box(locator: Locator) {
  const b = await locator.boundingBox();
  if (!b) throw new Error("not laid out");
  return b;
}

/** The x position (mm) of a column as the viewer draws it: the scene with the open panel's preview laid over it. */
export const shownColumnX = (page: Page, id = "col-a1") =>
  page.evaluate((columnId) => {
    const panels = window.__HAI_PANELS__;
    const doc = window.__HAI_SCENE__?.getSnapshot().doc ?? null;
    const column = panels?.shownDoc(doc)?.elements[columnId];
    return column?.type === "column" ? (column.position?.[0] ?? null) : null;
  }, id);

/** The x position (mm) of a column in the scene the bridge holds, which is what the agent reads. */
export const committedColumnX = (id = "col-a1") => {
  const column = current().scene.scene.doc.elements[id];
  return column?.type === "column" ? column.position[0] : null;
};

/** Calls one of the bridge's MCP tools the way an agent does, with a token issued to it. */
export async function callTool(name: string, args: Record<string, unknown> = {}) {
  const token = current().agentTokens.issue({ agent: "reviewer", tools: new Set([name]) });
  const res = await fetch(`http://127.0.0.1:${current().port}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  });
  const body = await res.text();
  const json = res.headers.get("content-type")?.includes("text/event-stream")
    ? (body
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .at(-1)
        ?.slice(5) ?? "null")
    : body;
  const result = JSON.parse(json).result as { content: Array<{ text?: string }> };
  return JSON.parse(result.content[0]?.text ?? "null");
}
