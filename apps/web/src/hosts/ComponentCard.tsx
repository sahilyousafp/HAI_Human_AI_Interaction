import {
  HOST_INFO,
  type HostComponent,
  type HostId,
  type HostObject,
  type Point2,
  type Point3Mm,
} from "@hai/protocol";
import { type FormEvent, type ReactNode, type RefObject, useState, useSyncExternalStore } from "react";
import type { ToolController } from "../tools/controller.ts";
import { boxOfObjects } from "../tools/host-targets.ts";
import { usePinnedCard } from "../tools/pinned-card.ts";
import { ToolIcon } from "../tools/ToolOverlays.tsx";
import { HostGlyph } from "./HostGlyph.tsx";
import type { HostMirror, HostMirrors } from "./host-mirror.ts";

/** How many components the card lists; the rest are counted. */
export const CARD_ROWS = 8;
/** How many of a component's own properties a row shows. */
const ROW_PROPERTIES = 3;

/** The largest quantity a component has, as people say it: "3.2 m³", "14 m²", "6 m". */
export function quantityText({ quantities }: HostComponent): string | null {
  const round = (v: number) => (v >= 100 ? Math.round(v) : Math.round(v * 10) / 10);
  if (quantities.volumeMm3) return `${round(quantities.volumeMm3 / 1e9)} m³`;
  if (quantities.areaMm2) return `${round(quantities.areaMm2 / 1e6)} m²`;
  if (quantities.lengthMm) return `${round(quantities.lengthMm / 1000)} m`;
  return null;
}

/** The host whose objects are selected now, if any (a selection is always one host's). */
function selectedHost(mirrors: HostMirrors): HostMirror | null {
  return mirrors.all.find((m) => m.getSnapshot().selection.length > 0) ?? null;
}

/** The objects a request from the card is limited to, while it is open: the selection in one host. */
export function cardLimit(mirrors: HostMirrors, activeTool: string): { host: HostId; ids: string[] } | null {
  if (activeTool !== "select") return null;
  const mirror = selectedHost(mirrors);
  const ids = mirror?.getSnapshot().selection ?? [];
  return mirror && ids.length > 0 ? { host: mirror.host, ids } : null;
}

function Row({ component, object }: { component: HostComponent | null; object: HostObject }): ReactNode {
  const quantity = component ? quantityText(component) : null;
  const properties = component ? Object.entries(component.properties).slice(0, ROW_PROPERTIES) : [];
  const facts = [component?.layer ?? object.layer, quantity, component?.material].filter(Boolean);
  return (
    <li className="component-row" data-testid="component-row" data-id={object.id}>
      <div className="component-name">
        <strong>{component?.name || object.name || component?.type || object.type}</strong>
        <span className="component-type">{component?.type ?? object.type}</span>
      </div>
      {facts.length > 0 && <div className="component-facts">{facts.join(" · ")}</div>}
      {properties.length > 0 && (
        <dl className="component-properties">
          {properties.map(([key, value]) => (
            <div key={key}>
              <dt>{key}</dt>
              <dd>{String(value)}</dd>
            </div>
          ))}
        </dl>
      )}
    </li>
  );
}

/**
 * What is selected in a host, on a card pinned to it while Select is active: each object as the host describes it
 * (type, layer, its largest quantity, material and a few of its own properties), Move, Rotate and Delete, and Ask
 * about this, which sends a request limited to these objects. It sits where the scene's selection card does and
 * covers no other panel.
 */
export function ComponentCard({
  controller,
  mirrors,
  project,
  wrapper,
  canAsk,
  onAsk,
}: {
  controller: ToolController;
  mirrors: HostMirrors;
  project(point: Point3Mm): Point2;
  wrapper: RefObject<HTMLElement | null>;
  canAsk: boolean;
  /** Sends a request about these objects only; false when it could not be sent. */
  onAsk(text: string, limit: { host: HostId; ids: string[] }): boolean;
}): ReactNode {
  const { activeId } = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  useSyncExternalStore(mirrors.subscribe, () => mirrors.all.map((m) => m.getSnapshot().version).join());
  const [text, setText] = useState("");
  const mirror = selectedHost(mirrors);
  const state = mirror?.getSnapshot();
  const objects = (state?.selection ?? []).flatMap((id) => mirror?.object(id) ?? []);
  const shown = activeId === "select" && mirror !== null && objects.length > 0;
  const box = objects.length > 0 ? boxOfObjects(objects) : null;
  const anchor: Point3Mm = box
    ? [(box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2, box.max[2]]
    : [0, 0, 0];
  const { card, leader, dot } = usePinnedCard<HTMLElement>(shown, anchor, project, wrapper);
  if (!shown || !mirror || !state) return null;

  const host = mirror.host;
  const label = HOST_INFO[host].label;
  const described = new Map(state.components.map((c) => [c.id, c]));
  const [first] = objects;
  const title = objects.length === 1 && first ? first.name || first.type : `${objects.length} objects`;
  const ids = objects.map((o) => o.id);
  const iconOf = (id: string) => controller.registry.get(id)?.icon ?? "";
  const ask = (event: FormEvent) => {
    event.preventDefault();
    const said = text.trim();
    if (said && onAsk(said, { host, ids })) setText("");
  };

  return (
    <>
      <svg className="selection-leader" aria-hidden="true">
        <line ref={leader} />
        <circle ref={dot} r={4} />
      </svg>
      <section
        ref={card}
        className="selection-card component-card"
        data-testid="component-card"
        data-host={host}
        data-hud
        aria-label={`${title} in ${label}`}
      >
        <header className="selection-head">
          <strong data-testid="component-title">{title}</strong>
          <span className="component-host">
            <HostGlyph host={host} size={14} />
            {label}
          </span>
        </header>
        <ul className="component-rows">
          {objects.slice(0, CARD_ROWS).map((object) => (
            <Row key={object.id} object={object} component={described.get(object.id) ?? null} />
          ))}
        </ul>
        {objects.length > CARD_ROWS && (
          <p className="component-more" data-testid="component-more">
            and {objects.length - CARD_ROWS} more
          </p>
        )}
        <div className="selection-actions">
          {(["move", "rotate"] as const).map((id) => (
            <button
              key={id}
              type="button"
              className="selection-action"
              data-testid={`component-${id}`}
              data-hand-press
              onClick={() => controller.choose(id)}
            >
              <ToolIcon path={iconOf(id)} size={18} />
              {id === "move" ? "Move" : "Rotate"}
            </button>
          ))}
          <button
            type="button"
            className="selection-action selection-action-risk"
            data-testid="component-delete"
            data-hand-press
            onClick={() => controller.deleteElements(ids)}
          >
            <ToolIcon path={iconOf("delete")} size={18} />
            Delete
          </button>
        </div>
        {canAsk && (
          <form className="component-ask" onSubmit={ask}>
            <input
              data-testid="component-ask-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={objects.length === 1 ? "Ask about this" : "Ask about these"}
              aria-label={`Ask the agent about ${title}`}
            />
            <button
              type="submit"
              className="selection-action selection-action-wide"
              data-testid="component-ask"
              data-hand-press
              disabled={text.trim().length === 0}
            >
              <ToolIcon path={iconOf("ask-agent")} size={16} />
              Ask
            </button>
          </form>
        )}
      </section>
    </>
  );
}
