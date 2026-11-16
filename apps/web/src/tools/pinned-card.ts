import type { Point2, Point3Mm } from "@hai/protocol";
import { type RefObject, useLayoutEffect, useRef } from "react";
import { type Box, placePanel } from "./place-panel.ts";

/** The panels a pinned card must not cover: every panel laid over the model. */
const OVER_THE_MODEL = '[data-hud], .camera-view, .view-cube-box, [data-testid="tool-notice"]';

/**
 * A card pinned to a point of the model (the top middle of a selection): it follows the camera with a line back to
 * the point, stays inside the view and covers no other panel. Returns the refs for the card, its line and the dot at
 * the point; the card is placed every frame while `shown`, since an orbit moves the camera with no event to hear.
 */
export function usePinnedCard<T extends HTMLElement = HTMLDivElement>(
  shown: boolean,
  [ax, ay, az]: Point3Mm,
  project: (point: Point3Mm) => Point2,
  wrapper: RefObject<HTMLElement | null>,
) {
  const card = useRef<T | null>(null);
  const leader = useRef<SVGLineElement | null>(null);
  const dot = useRef<SVGCircleElement | null>(null);
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
    let frame = requestAnimationFrame(function tick() {
      place();
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [shown, ax, ay, az, project, wrapper]);
  return { card, leader, dot };
}
