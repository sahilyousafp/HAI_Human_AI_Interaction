import type { ContextBuilding, ContextItem, Site } from "@hai/protocol";
import { itemPoint, signedArea } from "./context-store.ts";

type Pt = readonly [number, number];

/** A polygon clipped to an axis-aligned box (Sutherland-Hodgman); empty when it lies outside. */
export function clipToBox(polygon: ReadonlyArray<Pt>, min: Pt, max: Pt): Pt[] {
  type Edge = { inside: (p: Pt) => boolean; cut: (a: Pt, b: Pt) => Pt };
  const edges: Edge[] = [
    {
      inside: (p) => p[0] >= min[0],
      cut: (a, b) => [min[0], a[1] + ((b[1] - a[1]) * (min[0] - a[0])) / (b[0] - a[0])],
    },
    {
      inside: (p) => p[0] <= max[0],
      cut: (a, b) => [max[0], a[1] + ((b[1] - a[1]) * (max[0] - a[0])) / (b[0] - a[0])],
    },
    {
      inside: (p) => p[1] >= min[1],
      cut: (a, b) => [a[0] + ((b[0] - a[0]) * (min[1] - a[1])) / (b[1] - a[1]), min[1]],
    },
    {
      inside: (p) => p[1] <= max[1],
      cut: (a, b) => [a[0] + ((b[0] - a[0]) * (max[1] - a[1])) / (b[1] - a[1]), max[1]],
    },
  ];
  let output: Pt[] = [...polygon];
  for (const edge of edges) {
    const input = output;
    output = [];
    input.forEach((current, i) => {
      const previous = input[(i + input.length - 1) % input.length] as Pt;
      if (edge.inside(current)) {
        if (!edge.inside(previous)) output.push(edge.cut(previous, current));
        output.push(current);
      } else if (edge.inside(previous)) output.push(edge.cut(previous, current));
    });
    if (output.length === 0) break;
  }
  return output;
}

/** What the layer says about the square around the site, and what it cannot say (and why). */
export interface UrbanMetrics {
  radiusM: number;
  areaM2: number;
  buildings:
    | {
        count: number;
        /** The share of the square the buildings' footprints cover. */
        coverageRatio: number;
        /** Mean height of the buildings, weighted by footprint, metres. */
        meanHeightM: number;
        maxHeightM: number;
        /** The share of buildings whose height the source gave (the rest are worked out or a default). */
        heightsMeasuredShare: number;
      }
    | { missing: string };
  trees: { count: number } | { missing: string };
  greenShare: { value: number; basis: string } | { missing: string };
}

const round = (value: number, digits = 3) => Math.round(value * 10 ** digits) / 10 ** digits;

/**
 * The metrics of the square of half-side `radiusM` around the site's anchor, from what the layer holds. A kind of data
 * that was never fetched is reported as missing, with how to fetch it, and never guessed.
 */
export function urbanMetrics(input: {
  items: ReadonlyArray<ContextItem>;
  site: Site;
  radiusM: number;
  buildingsFetched: boolean;
  treesFetched: boolean;
  /** The green share of this square from the land cover map, when it was fetched. */
  greenShare: { value: number; basis: string } | null;
}): UrbanMetrics {
  const { items, site, radiusM } = input;
  const r = radiusM * 1000;
  const min: Pt = [site.anchorMm[0] - r, site.anchorMm[1] - r];
  const max: Pt = [site.anchorMm[0] + r, site.anchorMm[1] + r];
  const areaM2 = (2 * radiusM) ** 2;

  let buildings: UrbanMetrics["buildings"];
  if (!input.buildingsFetched) {
    buildings = { missing: "The buildings were not fetched. Ask for them with urban_buildings first." };
  } else {
    let count = 0;
    let covered = 0;
    let weighted = 0;
    let tallest = 0;
    let measured = 0;
    for (const item of items) {
      if (item.kind !== "building") continue;
      const building = item as ContextBuilding;
      const clipped = clipToBox(building.footprint, min, max);
      const area = Math.abs(signedArea(clipped)) / 1e6;
      if (clipped.length < 3 || area === 0) continue;
      count++;
      covered += area;
      weighted += area * building.heightMm;
      tallest = Math.max(tallest, building.heightMm);
      if (building.heightSource === "measured") measured++;
    }
    buildings = {
      count,
      coverageRatio: round(covered / areaM2),
      meanHeightM: count === 0 ? 0 : round(weighted / covered / 1000, 1),
      maxHeightM: round(tallest / 1000, 1),
      heightsMeasuredShare: count === 0 ? 0 : round(measured / count),
    };
  }

  const trees: UrbanMetrics["trees"] = input.treesFetched
    ? {
        count: items.filter((i) => {
          if (i.kind !== "tree") return false;
          const [x, y] = itemPoint(i);
          return x >= min[0] && x <= max[0] && y >= min[1] && y <= max[1];
        }).length,
      }
    : { missing: "The trees were not fetched. Ask for them with urban_buildings (include_trees) first." };

  return {
    radiusM,
    areaM2,
    buildings,
    trees,
    greenShare: input.greenShare ?? {
      missing: `The vegetation cover for a radius of ${radiusM} m was not fetched. Ask for it with urban_vegetation (radius_m ${radiusM}) first.`,
    },
  };
}
