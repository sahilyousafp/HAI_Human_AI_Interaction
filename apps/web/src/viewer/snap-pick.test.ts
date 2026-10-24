import { describe, expect, it } from "vitest";
import { convexHull, distanceToHull, nearestModel, snapRadius } from "./snap-pick.ts";

const square = (x: number, y: number, size = 100): Array<[number, number]> => [
  [x, y],
  [x + size, y],
  [x + size, y + size],
  [x, y + size],
];

describe("convexHull", () => {
  it("drops points inside and keeps the outline", () => {
    const hull = convexHull([...square(0, 0), [50, 50]]);
    expect(hull).toHaveLength(4);
    expect(hull).not.toContainEqual([50, 50]);
  });

  it("copes with a line and a single point", () => {
    expect(convexHull([[1, 1]])).toEqual([[1, 1]]);
    expect(
      convexHull([
        [0, 0],
        [10, 0],
        [5, 0],
      ]).length,
    ).toBeLessThanOrEqual(2);
  });
});

describe("distanceToHull", () => {
  const hull = convexHull(square(0, 0));
  it("is 0 inside and on the edge", () => {
    expect(distanceToHull([50, 50], hull)).toBe(0);
    expect(distanceToHull([100, 30], hull)).toBe(0);
  });

  it("is the distance to the nearest edge or corner outside", () => {
    expect(distanceToHull([130, 50], hull)).toBeCloseTo(30);
    expect(distanceToHull([103, 104], hull)).toBeCloseTo(5);
  });

  it("works for a thin outline that is only a segment", () => {
    expect(
      distanceToHull(
        [5, 10],
        [
          [0, 0],
          [10, 0],
        ],
      ),
    ).toBeCloseTo(10);
  });
});

describe("nearestModel", () => {
  const near = { id: "near", corners: square(200, 0), depth: 10 };
  const far = { id: "far", corners: square(400, 0), depth: 10 };

  it("picks the model whose outline is closest within reach", () => {
    expect(nearestModel([far, near], [190, 50], 24)).toBe("near");
    expect(nearestModel([far, near], [390, 50], 24)).toBe("far");
  });

  it("picks nothing when every model is out of reach", () => {
    expect(nearestModel([near, far], [100, 50], 24)).toBeNull();
    expect(nearestModel([], [0, 0], 24)).toBeNull();
  });

  it("inside two outlines, the one nearer the camera wins", () => {
    const front = { id: "front", corners: square(0, 0), depth: 5 };
    const back = { id: "back", corners: square(0, 0), depth: 50 };
    expect(nearestModel([back, front], [50, 50], 24)).toBe("front");
  });

  it("a closer outline beats a nearer one that is further away on screen", () => {
    const wall = { id: "wall", corners: square(100, 0, 10), depth: 80 };
    const column = { id: "column", corners: square(140, 0, 10), depth: 5 };
    expect(nearestModel([column, wall], [115, 5], 40)).toBe("wall");
  });
});

describe("snapRadius", () => {
  it("is a twentieth of the view height, between 24 and 64 px", () => {
    expect(snapRadius(668)).toBeCloseTo(33.4);
    expect(snapRadius(200)).toBe(24);
    expect(snapRadius(3000)).toBe(64);
  });
});
