import { type ContextRaster, OPEN_DATA_SOURCES } from "@hai/protocol";
import type { ContextState } from "./context-client.ts";

/** The day of an ISO date-time, as the data gives it (the same in every locale). */
const day = (iso: string) => (/^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10) : iso);

/** A source as the user knows it: its name, not its id. */
const sourceName = (id: string) => OPEN_DATA_SOURCES.find((s) => s.id === id)?.name ?? id;

/** A raster's colours as a gradient, left to right from its lowest value to its highest. */
function gradient(raster: ContextRaster): string {
  const [low, high] = raster.range;
  const span = high - low || 1;
  const stops = [...raster.legend]
    .sort((a, b) => a.value - b.value)
    .map((s) => `${s.color} ${Math.round(Math.min(1, Math.max(0, (s.value - low) / span)) * 100)}%`);
  return `linear-gradient(90deg, ${stops.join(", ")})`;
}

/**
 * What the ground overlay shows (quantity, unit, source, date and a colour scale) and the credits the data asks for,
 * over the viewer while the layer is on screen. A layer built for another site says it is out of date.
 */
export function ContextLegend({ state, visible }: { state: ContextState; visible: boolean }) {
  const rasters = state.items.filter((i): i is ContextRaster => i.kind === "raster");
  if (!visible || state.items.length === 0) return null;
  return (
    <aside
      className="context-legend"
      data-testid="context-legend"
      data-stale={state.stale ? "true" : undefined}
    >
      {state.stale && (
        <p className="context-stale" data-testid="context-stale" role="status">
          Out of date: the site changed after this was fetched. Ask Urban to fetch it again.
        </p>
      )}
      {rasters.map((raster) => (
        <div key={raster.id} className="context-raster" data-testid="context-raster">
          <strong>{raster.label}</strong>
          <span className="muted">
            {raster.quantity}, {raster.unit} - {sourceName(raster.source)}, {day(raster.date)}
          </span>
          <span className="context-scale" style={{ background: gradient(raster) }} aria-hidden="true" />
          <span className="context-range">
            <span>{raster.range[0]}</span>
            <span>{raster.range[1]}</span>
          </span>
        </div>
      ))}
      {state.credits.length > 0 && (
        <p className="context-credits muted" data-testid="context-credits">
          {state.credits.map((c) => c.attribution).join(" / ")}
        </p>
      )}
    </aside>
  );
}
