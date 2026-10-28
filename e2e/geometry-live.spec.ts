// Manual: the real, signed-in Claude Code CLI copies an element along a line with a tapering width.
//   HAI_LIVE_CLAUDE=1 pnpm exec playwright test e2e/geometry-live.spec.ts
import { expect, test } from "@playwright/test";
import { ENDED, start, until } from "./live-support.ts";

const live = process.env.HAI_LIVE_CLAUDE === "1";
test.skip(!live, "manual: needs the signed-in Claude Code CLI (HAI_LIVE_CLAUDE=1)");
test.setTimeout(600_000);

test("copy this along the line every 3 m, the width starting at 1.5 m and tapering to 0.5 m", async ({
  page,
}) => {
  const { bridge, team } = await start(page);
  try {
    await page.evaluate(() =>
      window.__HAI_SCENE__?.apply("Draw rail", [
        {
          op: "create",
          element: {
            id: "rail",
            name: "Rail",
            type: "line",
            points: [
              [0, -20000, 0],
              [12000, -20000, 0],
            ],
            closed: false,
            properties: {},
          },
        },
      ]),
    );
    await expect.poll(() => bridge.scene.scene.doc.elements.rail?.type).toBe("line");
    const before = new Set(Object.keys(bridge.scene.scene.doc.elements));
    const copies = () =>
      Object.values(bridge.scene.scene.doc.elements).filter(
        (e) => e.type === "massing" && !before.has(e.id),
      ) as Array<{ origin: number[]; size: number[] }>;

    await page
      .getByTestId("agent-input")
      .fill(
        "Architect, copy block-b along the line called rail, one copy every 3 m. The width of the copies starts at 1.5 m and tapers to 0.5 m.",
      );
    await page.getByTestId("agent-input").press("Enter");
    const finished = await until(
      page,
      () => copies().length >= 4 && team.board.every((t) => ENDED.includes(t.status)),
      480_000,
    );
    const made = copies();
    console.log(`live: ${made.length} copies, widths ${JSON.stringify(made.map((c) => c.size[1]))}`);
    expect(finished).toBe(true);
    expect(made.length).toBe(5); // 0, 3, 6, 9 and 12 m along a 12 m line
    const widths = made.map((c) => c.size[1] ?? 0).sort((a, b) => b - a);
    expect(widths[0]).toBeCloseTo(1500, -1);
    expect(widths.at(-1)).toBeCloseTo(500, -1);
  } finally {
    await bridge.stop();
  }
});
