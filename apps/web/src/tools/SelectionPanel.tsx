import type { Point2, Point3Mm } from "@hai/protocol";
import { elementBounds, groupOf, groupOps, newGroupId, soleGroup, ungroupOps, unionBounds } from "@hai/scene";
import { type ReactNode, type RefObject, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import type { SceneClient } from "../scene/scene-client.ts";
import type { Visibility } from "../viewer/visibility.ts";
import type { ToolController } from "./controller.ts";
import { type Box, placePanel } from "./place-panel.ts";
import { ToolIcon } from "./ToolOverlays.tsx";

const GROUP_ICON = "M4 4h16v16H4zM8 8h3v3H8zM13 13h3v3h-3z";
const UNGROUP_ICON = "M4 4h6v6H4zM14 14h6v6h-6zM14 7h3a3 3 0 0 1 3 3M10 17H7a3 3 0 0 1-3-3";
const HIDE_ICON =
  "M3 3l18 18M10.6 5.1A10 10 0 0 1 22 12a14 14 0 0 1-3 3.8M6.6 6.6A14 14 0 0 0 2 12a10 10 0 0 0 13.4 5.4";

/** The panels the card must not cover: every panel laid over the model. */
const OVER_THE_MODEL = '[data-hud], .camera-view, .view-cube-box, [data-testid="tool-notice"]';

function Action({
  id,
  label,
  icon,
  wide,
  risk,
  onPress,
}: {
  id: string;
  label: string;
  icon: string;
  wide?: boolean;
  risk?: boolean;
  onPress(): void;
}): ReactNode {
  return (
    <button
      type="button"
      className={`selection-action${wide ? " selection-action-wide" : ""}${risk ? " selection-action-risk" : ""}`}
      data-testid={`selection-${id}`}
      data-hand-press
      onClick={onPress}
    >
      <ToolIcon path={icon} size={18} />
      {label}
    </button>
  );
}

/**
 * The options for what is selected, on a card pinned to the top middle of it, while Select is active. It follows the
 * camera with a line back to the selection, stays inside the view, and covers no other panel. Every button is one a
 * hand can press, and the model under the card cannot be picked through it.
 */
export function SelectionPanel({
  controller,
  client,
  visibility,
  project,
  wrapper,
  canAsk,
}: {
  controller: ToolController;
  client: SceneClient;
  visibility: Visibility;
  /** Where a model point is in the view, 0 to 1 across and down. */
  project(point: Point3Mm): Point2;
  wrapper: RefObject<HTMLElement | null>;
  canAsk: boolean;
}): ReactNode {
  const { activeId } = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const { doc, selection } = useSyncExternalStore(client.subscribe, client.getSnapshot);
  const hidden = useSyncExternalStore(visibility.subscribe, visibility.getSnapshot);
  const card = useRef<HTMLDivElement | null>(null);
  const leader = useRef<SVGLineElement | null>(null);
  const dot = useRef<SVGCircleElement | null>(null);

  const elements = selection.flatMap((id) => {
    const element = doc?.elements[id];
    return element && !hidden.has(id) ? [element] : [];
  });
  const box = doc ? unionBounds(elements.map((element) => elementBounds(element, doc.levels))) : null;
  const shown = activeId === "select" && box !== null;
  const ax = box ? (box.min[0] + box.max[0]) / 2 : 0;
  const ay = box ? (box.min[1] + box.max[1]) / 2 : 0;
  const az = box ? box.max[2] : 0;

  useLayoutEffect(() => {
    if (!shown) return;
    const place = () => {
      const view = wrapper.current;
      const panel = card.current;
      if (!view || !panel) return;
      const frame = view.getBoundingClientRect();
      const [x, y] = project([ax, ay, az]);
      const anchor: [number, number] = [x * frame.width, y * frame.height];
      const obstacles: Box[] = [...view.querySelectorAll(OVER_THE_MODEL)]
        .filter((el) => !panel.contains(el))
        .map((el) => {
          const r = el.getBoundingClientRect();
          return { left: r.left - frame.left, top: r.top - frame.top, width: r.width, height: r.height };
        })
        .filter((b) => b.width > 0 && b.height > 0);
      const size = { width: panel.offsetWidth, height: panel.offsetHeight };
      const { left, top } = placePanel(anchor, size, frame, obstacles);
      panel.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
      panel.style.visibility = "visible";
      const line = leader.current;
      const mark = dot.current;
      if (!line || !mark) return;
      const onView = x >= 0 && x <= 1 && y >= 0 && y <= 1;
      line.style.display = onView ? "" : "none";
      mark.style.display = onView ? "" : "none";
      line.setAttribute("x1", String(left + size.width / 2));
      line.setAttribute("y1", String(top + size.height));
      line.setAttribute("x2", String(anchor[0]));
      line.setAttribute("y2", String(anchor[1]));
      mark.setAttribute("cx", String(anchor[0]));
      mark.setAttribute("cy", String(anchor[1]));
    };
    place();
    // The camera moves every frame during an orbit, by hand or by the agent's view, with no event to listen to.
    let frame = requestAnimationFrame(function tick() {
      place();
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [shown, ax, ay, az, project, wrapper]);

  if (!shown || !doc) return null;

  const ids = elements.map((element) => element.id);
  const [first] = elements;
  const group = soleGroup(doc, ids);
  const several = ids.length > 1;
  let title = first ? first.name : "";
  let detail = first ? first.type : "";
  if (group) {
    title = `Group of ${ids.length}`;
    detail = group;
  } else if (several) {
    title = `${ids.length} selected`;
    detail = "not grouped";
  } else if (first && groupOf(first)) {
    // A group of one is what is left of a group after its other members went.
    detail = groupOf(first) ?? detail;
  }
  const iconOf = (id: string) => controller.registry.get(id)?.icon ?? "";

  return (
    <>
      <svg className="selection-leader" aria-hidden="true">
        <line ref={leader} />
        <circle ref={dot} r={4} />
      </svg>
      <div
        ref={card}
        className="selection-card"
        data-testid="selection-panel"
        data-hud
        role="toolbar"
        aria-label={`Options for ${title}`}
      >
        <header className="selection-head">
          <strong data-testid="selection-title">{title}</strong>
          <span className="selection-detail" data-testid="selection-detail">
            {detail}
          </span>
        </header>
        <div className="selection-actions">
          {group && (
            <Action
              id="ungroup"
              label="Ungroup"
              icon={UNGROUP_ICON}
              wide
              onPress={() => client.apply("Ungroup", ungroupOps(doc, ids))}
            />
          )}
          {!group && several && (
            <Action
              id="group"
              label="Group"
              icon={GROUP_ICON}
              wide
              onPress={() => client.apply("Group", groupOps(doc, ids, newGroupId()))}
            />
          )}
          <Action id="move" label="Move" icon={iconOf("move")} onPress={() => controller.choose("move")} />
          <Action
            id="rotate"
            label="Rotate"
            icon={iconOf("rotate")}
            onPress={() => controller.choose("rotate")}
          />
          <Action id="copy" label="Copy" icon={iconOf("copy")} onPress={() => controller.choose("copy")} />
          <Action
            id="delete"
            label="Delete"
            icon={iconOf("delete")}
            risk
            onPress={() => controller.deleteElements(ids)}
          />
          <Action
            id="hide"
            label="Hide"
            icon={HIDE_ICON}
            onPress={() => {
              visibility.hide(ids);
              client.select([]);
              controller.flash(`Hid ${title}. Say "show all" to bring it back.`);
            }}
          />
          {canAsk && (
            <Action
              id="ask"
              label="Ask agent"
              icon={iconOf("ask-agent")}
              onPress={() => controller.choose("ask-agent")}
            />
          )}
        </div>
      </div>
    </>
  );
}
