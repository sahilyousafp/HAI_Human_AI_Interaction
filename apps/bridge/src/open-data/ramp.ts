import type { ContextRaster } from "@hai/protocol";
import { encodePng, pngDataUrl } from "./png.ts";
import type { ModelGrid } from "./raster-grid.ts";

export type Stop = { value: number; color: string };

const parse = (hex: string): [number, number, number] => [
  Number.parseInt(hex.slice(1, 3), 16),
  Number.parseInt(hex.slice(3, 5), 16),
  Number.parseInt(hex.slice(5, 7), 16),
];

/** The colour of a value on a ramp of linear stops (#rrggbb): the ends hold beyond the first and last stop. */
export function rampRgb(stops: ReadonlyArray<Stop>, value: number): [number, number, number] {
  const sorted = [...stops].sort((a, b) => a.value - b.value);
  const first = sorted[0] as Stop;
  const last = sorted.at(-1) as Stop;
  if (value <= first.value) return parse(first.color);
  if (value >= last.value) return parse(last.color);
  for (let i = 1; i < sorted.length; i++) {
    const hi = sorted[i] as Stop;
    const lo = sorted[i - 1] as Stop;
    if (value <= hi.value) {
      const t = (value - lo.value) / (hi.value - lo.value || 1);
      const a = parse(lo.color);
      const b = parse(hi.color);
      return [0, 1, 2].map((k) =>
        Math.round((a[k] as number) + ((b[k] as number) - (a[k] as number)) * t),
      ) as [number, number, number];
    }
  }
  return parse(last.color);
}

/** A grid as a picture of its values on a ramp; a cell with no value (NaN) is transparent. */
export function gridPicture(grid: ModelGrid, stops: ReadonlyArray<Stop>, opacity = 255): string {
  const rgba = new Uint8Array(grid.size * grid.size * 4);
  grid.values.forEach((value, i) => {
    if (Number.isNaN(value)) return;
    const [r, g, b] = rampRgb(stops, value);
    rgba.set([r, g, b, opacity], i * 4);
  });
  return pngDataUrl(encodePng(rgba, grid.size, grid.size));
}

/** The ground overlay of a grid: its picture over the model square around the anchor, with its legend. */
export function rasterItem(
  grid: ModelGrid,
  info: {
    id: string;
    label: string;
    quantity: string;
    unit: string;
    source: string;
    date: string;
    anchorMm: readonly [number, number];
    radiusM: number;
    range: [number, number];
    stops: ReadonlyArray<Stop>;
  },
): ContextRaster {
  const r = info.radiusM * 1000;
  return {
    id: info.id,
    kind: "raster",
    label: info.label,
    quantity: info.quantity,
    unit: info.unit,
    source: info.source,
    date: info.date,
    minMm: [info.anchorMm[0] - r, info.anchorMm[1] - r],
    maxMm: [info.anchorMm[0] + r, info.anchorMm[1] + r],
    image: gridPicture(grid, info.stops, 210),
    range: info.range,
    legend: info.stops.map((s) => ({ value: s.value, color: s.color })),
  };
}
