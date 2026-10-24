// Runs against the real, signed-in Claude Code CLI, so it is manual: CI and a plain `pnpm test:e2e` skip it. Run it with
//   HAI_LIVE_CLAUDE=1 pnpm exec playwright test e2e/python-live.spec.ts
// The real agent is asked to model something and save it as a .3dm with no Rhino anywhere: it should use the Python
// workbench (python_run), the user allows the script, and the written file is imported into the viewer.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { sharedPythonEnv } from "../apps/bridge/test/python-env.ts";
import { ClaudeCliProvider } from "../packages/agent-core/src/index.ts";
import { openViewer, startTestBridge } from "./viewer.ts";

const live = process.env.HAI_LIVE_CLAUDE === "1";
test.skip(!live, "manual: needs the signed-in Claude Code CLI (HAI_LIVE_CLAUDE=1)");

test("the real agent models a canopy with the Python workbench and the file imports into the viewer", async ({
  page,
}, testInfo) => {
  test.setTimeout(600_000);
  const env = await sharedPythonEnv();
  test.skip(!env, "needs a Python 3.10 or newer on this machine");
  const bridge = await startTestBridge(page, {
    agent: new ClaudeCliProvider(),
    ...(env ? { pythonEnv: env } : {}),
  });
  try {
    await openViewer(page);
    await page.evaluate(() => window.__HAI_INPUT__?.engaged(true));
    await expect(page.getByTestId("agent-status")).toHaveAttribute("data-state", "idle", { timeout: 60_000 });
    await page
      .getByTestId("agent-input")
      .fill(
        "Architect, use python_run to model a freeform canopy, six metres square, about three metres up, as a NURBS surface, and save it as canopy.3dm in the project. Do not use Rhino.",
      );
    await page.getByTestId("agent-input").press("Enter");

    // The script waits for the user: allow it as soon as the card shows (a second card, for a retry, is allowed too).
    const allow = page.getByRole("button", { name: "Allow", exact: true });
    const files = page.getByTestId("written-files");
    for (let i = 0; i < 90 && !(await files.isVisible()); i++) {
      if (await allow.first().isVisible()) {
        await page.screenshot({ path: testInfo.outputPath(`card-${i}.png`) });
        await allow.first().click();
      }
      await page.waitForTimeout(2_000);
    }
    await expect(files).toContainText("canopy.3dm", { timeout: 10_000 });
    await page.screenshot({ path: testInfo.outputPath("written.png") });

    const before = Object.keys(bridge.scene.scene.doc.elements).length;
    await files.getByTestId("written-import").click();
    await expect
      .poll(() => Object.keys(bridge.scene.scene.doc.elements).length, { timeout: 30_000 })
      .toBeGreaterThan(before);
    await page.waitForTimeout(1_000);
    await page.screenshot({ path: testInfo.outputPath("imported.png") });
    const imported = Object.values(bridge.scene.scene.doc.elements).filter((e) => e.type === "imported");
    console.log(
      `LIVE imported: ${JSON.stringify(imported.map((e) => ({ name: e.name, bounds: e.bounds })))}`,
    );
    expect(imported.length).toBeGreaterThan(0);
  } finally {
    await bridge.stop();
  }
});

test("the real agent models a curve with the Python workbench and it is drawn in the viewer", async ({
  page,
}, testInfo) => {
  test.setTimeout(600_000);
  const env = await sharedPythonEnv();
  test.skip(!env, "needs a Python 3.10 or newer on this machine");
  const bridge = await startTestBridge(page, {
    agent: new ClaudeCliProvider(),
    ...(env ? { pythonEnv: env } : {}),
  });
  try {
    await openViewer(page);
    await page.evaluate(() => window.__HAI_INPUT__?.engaged(true));
    await expect(page.getByTestId("agent-status")).toHaveAttribute("data-state", "idle", { timeout: 60_000 });
    await page
      .getByTestId("agent-input")
      .fill(
        "Architect, use python_run to draw a smooth NURBS curve: a helix of three turns, one metre in radius and six metres high, and save it as helix.3dm in the project. Do not use Rhino.",
      );
    await page.getByTestId("agent-input").press("Enter");
    const allow = page.getByRole("button", { name: "Allow", exact: true });
    const files = page.getByTestId("written-files");
    for (let i = 0; i < 90 && !(await files.isVisible()); i++) {
      if (await allow.first().isVisible()) await allow.first().click();
      await page.waitForTimeout(2_000);
    }
    await expect(files).toContainText("helix.3dm", { timeout: 10_000 });
    await files.getByTestId("written-import").click();
    await expect(page.getByTestId("import-summary")).toContainText("curve", { timeout: 30_000 });
    const summary = await page.getByTestId("import-summary").textContent();
    await page.waitForTimeout(1_000);
    await page.screenshot({ path: testInfo.outputPath("helix.png") });
    const imported = Object.values(bridge.scene.scene.doc.elements).filter((e) => e.type === "imported");
    console.log(`LIVE summary: ${summary}`);
    console.log(
      `LIVE imported: ${JSON.stringify(imported.map((e) => ({ name: e.name, bounds: e.bounds })))}`,
    );
    expect(imported.length).toBeGreaterThan(0);
  } finally {
    await bridge.stop();
  }
});

test("asked for curved form in plain words, the real agent reaches for the Python workbench on its own", async ({
  page,
}, testInfo) => {
  test.setTimeout(600_000);
  const env = await sharedPythonEnv();
  test.skip(!env, "needs a Python 3.10 or newer on this machine");
  const bridge = await startTestBridge(page, {
    agent: new ClaudeCliProvider(),
    ...(env ? { pythonEnv: env } : {}),
  });
  try {
    await openViewer(page);
    await page.evaluate(() => window.__HAI_INPUT__?.engaged(true));
    await expect(page.getByTestId("agent-status")).toHaveAttribute("data-state", "idle", { timeout: 60_000 });
    await page
      .getByTestId("agent-input")
      .fill(
        "Architect, model a small pavilion with a smooth onion dome and curved arches over its doorways.",
      );
    await page.getByTestId("agent-input").press("Enter");
    const allow = page.getByRole("button", { name: "Allow", exact: true });
    const files = page.getByTestId("written-files");
    let said = "";
    for (let i = 0; i < 120 && !(await files.isVisible()); i++) {
      if (await allow.first().isVisible()) await allow.first().click();
      await page.waitForTimeout(2_000);
    }
    said =
      (await page
        .getByTestId("agent-text")
        .last()
        .textContent()
        .catch(() => "")) ?? "";
    console.log(`LIVE agent said: ${said.slice(0, 300)}`);
    await page.screenshot({ path: testInfo.outputPath("unprompted.png") });
    await expect(files).toBeVisible({ timeout: 10_000 });
    console.log(`LIVE files: ${await files.textContent()}`);
    expect(Object.keys(bridge.scene.scene.doc.elements).length).toBeGreaterThan(0);
  } finally {
    await bridge.stop();
  }
});

test("asked of Mochi with no specialist named, the lead does not say curves are impossible and the team builds them", async ({
  page,
}, testInfo) => {
  test.setTimeout(600_000);
  const env = await sharedPythonEnv();
  test.skip(!env, "needs a Python 3.10 or newer on this machine");
  const bridge = await startTestBridge(page, {
    agent: new ClaudeCliProvider(),
    ...(env ? { pythonEnv: env } : {}),
  });
  try {
    await openViewer(page);
    await page.evaluate(() => window.__HAI_INPUT__?.engaged(true));
    await expect(page.getByTestId("agent-status")).toHaveAttribute("data-state", "idle", { timeout: 60_000 });
    await page
      .getByTestId("agent-input")
      .fill(
        "Build a domed mosque with a truly smooth dome and curved arches: real curves, not faceted shapes.",
      );
    await page.getByTestId("agent-input").press("Enter");
    const allow = page.getByRole("button", { name: "Allow", exact: true });
    const files = page.getByTestId("written-files");
    for (let i = 0; i < 150 && !(await files.isVisible()); i++) {
      if (await allow.first().isVisible()) await allow.first().click();
      await page.waitForTimeout(2_000);
    }
    const texts = await page.getByTestId("agent-text").allTextContents();
    console.log(`LIVE lead said: ${texts.join(" | ").slice(0, 500)}`);
    await page.screenshot({ path: testInfo.outputPath("lead.png") });
    expect(texts.join(" ")).not.toMatch(/can't|cannot|not able|no NURBS|don't have that ability/i);
    await expect(files).toBeVisible({ timeout: 10_000 });
    console.log(`LIVE files: ${await files.textContent()}`);
    expect(Object.keys(bridge.scene.scene.doc.elements).length).toBeGreaterThan(0);
  } finally {
    await bridge.stop();
  }
});

/** A project's Architect as an earlier HAI wrote it: eight tools, none for Python, the view or panels. */
const OLD_ARCHITECT = `---
name: architect
description: Architecture: massing, levels, walls, slabs, columns and cores. Creates and edits building elements.
tools: mcp__hai__get_scene_summary, mcp__hai__get_elements, mcp__hai__get_user_context, mcp__hai__capture_view, mcp__hai__create_elements, mcp__hai__update_elements, mcp__hai__delete_elements, mcp__hai__set_selection
model: sonnet
---

You are Architect, the team's architectural designer. You plan and model massing, levels, walls, slabs,
columns, cores and stairs with sensible proportions and clearances.

You receive tasks from Mochi, the team lead. Do the task with the hai tools, then end with a short summary of
what you did and anything left open: it goes back to Mochi, who reports to the user. Lengths are millimetres, Z is up.
`;

test.describe("a project whose Architect file is the old eight-tool one", () => {
  async function open(page: import("@playwright/test").Page) {
    const env = await sharedPythonEnv();
    test.skip(!env, "needs a Python 3.10 or newer on this machine");
    const bridge = await startTestBridge(page, {
      agent: new ClaudeCliProvider(),
      ...(env ? { pythonEnv: env } : {}),
    });
    const dir = join(bridge.scene.projectDir ?? "", ".claude", "agents");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "architect.md"), OLD_ARCHITECT);
    await openViewer(page);
    await page.evaluate(() => window.__HAI_INPUT__?.engaged(true));
    await expect(page.getByTestId("agent-status")).toHaveAttribute("data-state", "idle", { timeout: 60_000 });
    return bridge;
  }

  test("it still writes curves with Python", async ({ page }) => {
    test.setTimeout(600_000);
    const bridge = await open(page);
    try {
      await page
        .getByTestId("agent-input")
        .fill("Build a domed pavilion with a truly smooth NURBS dome and curved arches.");
      await page.getByTestId("agent-input").press("Enter");
      const allow = page.getByRole("button", { name: "Allow", exact: true });
      const files = page.getByTestId("written-files");
      for (let i = 0; i < 150 && !(await files.isVisible()); i++) {
        if (await allow.first().isVisible()) await allow.first().click();
        await page.waitForTimeout(2_000);
      }
      console.log(
        `LIVE said: ${(await page.getByTestId("agent-text").allTextContents()).join(" | ").slice(0, 400)}`,
      );
      await expect(files).toBeVisible({ timeout: 10_000 });
      console.log(`LIVE files: ${await files.textContent()}`);
    } finally {
      await bridge.stop();
    }
  });

  test("it offers a panel when the user wants to tune values", async ({ page }) => {
    test.setTimeout(600_000);
    const bridge = await open(page);
    try {
      await page
        .getByTestId("agent-input")
        .fill(
          "Architect, I want about 150 millimetres of clearance between the column col-a1 and the north wall, with a tolerance. Let me tune it.",
        );
      await page.getByTestId("agent-input").press("Enter");
      await expect(page.getByTestId("offer-card").last()).toBeVisible({ timeout: 300_000 });
      console.log(
        `LIVE offer: ${await page.getByTestId("offer-card").last().getByTestId("offer-purpose").textContent()}`,
      );
    } finally {
      await bridge.stop();
    }
  });
});
