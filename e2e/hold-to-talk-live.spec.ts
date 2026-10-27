// Manual: the real, signed-in Claude Code CLI builds from what the user pointed out.
//   HAI_LIVE_CLAUDE=1 pnpm exec playwright test e2e/hold-to-talk-live.spec.ts
import { expect, test } from "@playwright/test";
import { handDraw, openGround, references, run } from "./hands.ts";
import { ENDED, start, until } from "./live-support.ts";

const live = process.env.HAI_LIVE_CLAUDE === "1";
test.skip(!live, "manual: needs the signed-in Claude Code CLI (HAI_LIVE_CLAUDE=1)");
test.setTimeout(600_000);

test("a wall along S1: Architect builds a wall on the path the left hand drew", async ({ page }) => {
  const { bridge, team } = await start(page);
  try {
    const [x, y] = await openGround(page, 8000, 2000);
    await page.keyboard.press("l");
    await handDraw(page, run([x, y + 1000], [x + 8000, y + 1000]));
    await expect.poll(async () => (await references(page)).sketches.map((s) => s.label)).toEqual(["S1"]);
    const [sketch] = (await references(page)).sketches;
    const [start_, end] = [sketch?.points[0], sketch?.points.at(-1)];
    if (!start_ || !end) throw new Error("no sketch");
    const wallsBefore = Object.keys(bridge.scene.scene.doc.elements).filter((id) => id.startsWith("wall"));

    await page.getByTestId("agent-input").fill("Architect, a wall along S1");
    await page.getByTestId("agent-input").press("Enter");
    await expect(page.getByTestId("sketch-label")).toHaveCount(0);

    const newWall = () =>
      Object.values(bridge.scene.scene.doc.elements).find(
        (e) => e.type === "wall" && !wallsBefore.includes(e.id),
      ) as { start: [number, number]; end: [number, number] } | undefined;
    const finished = await until(
      page,
      () => newWall() !== undefined && team.board.every((t) => ENDED.includes(t.status)),
      480_000,
    );
    expect(finished).toBe(true);
    const wall = newWall();
    if (!wall) throw new Error("no wall");
    // Its ends are the sketch's ends (either way round), within 300 mm.
    const near = (a: number[], b: number[]) =>
      Math.hypot((a[0] ?? 0) - (b[0] ?? 0), (a[1] ?? 0) - (b[1] ?? 0)) <= 300;
    const along =
      (near(wall.start, start_) && near(wall.end, end)) || (near(wall.start, end) && near(wall.end, start_));
    console.log(
      `live: S1 ${JSON.stringify(sketch?.points)} -> wall ${JSON.stringify([wall.start, wall.end])}`,
    );
    expect(along).toBe(true);
  } finally {
    await bridge.stop();
  }
});
