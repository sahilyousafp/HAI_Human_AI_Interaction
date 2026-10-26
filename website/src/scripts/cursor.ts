// Drive the hand cursor (components/HandCursor.astro). The index fingertip is the hotspot and tracks the
// pointer exactly; everything else is on springs so the hand moves like a hand: it tilts into fast moves,
// pinches with a little squash on press, grabs and drags the page on scroll, rings anything clickable, and
// switches to light ink over the dark sections.

import { applyPose, INDEX_TIP, pose, reducedMotion, Spring, VIEWBOX } from "../lib/hand";
import { isDark } from "./theme";

const el = document.querySelector<HTMLElement>("[data-cursor]");
const svg = el?.querySelector<SVGSVGElement>("[data-hand]");
const mouse = matchMedia("(hover: hover) and (pointer: fine)");

if (el && svg && mouse.matches && !reducedMotion()) {
  document.documentElement.classList.add("hand-cursor-on");

  const [vx, vy, vw] = VIEWBOX.split(" ").map(Number);
  // Matches .hc-hand's width in HandCursor.astro.
  const WIDTH = 41;
  const scale = WIDTH / vw;
  const CLICKABLE = "a, button, [role='button'], label, summary, video, [data-card], .hero .hand";
  // How far the hand drags the page per scroll, in px, and how long after the last wheel event it lets go.
  const DRAG = 8;
  const RELEASE_MS = 180;
  // Degrees of tilt per px/ms of horizontal speed, and the most it tilts.
  const TILT = 9;
  const MAX_TILT = 16;

  const pinch = new Spring(0, 130);
  const tilt = new Spring(0, 260);
  const drag = new Spring(0, 220);
  const squash = new Spring(1, 200);

  let x = -100;
  let y = -100;
  let speed = 0;
  let pressed = false;
  let scrollTimer = 0;
  let last = performance.now();

  const tick = (now: number) => {
    const dt = Math.min(64, now - last);
    last = now;
    // Speed decays between pointer events, so the hand straightens when the mouse stops.
    speed *= Math.exp(-dt / 70);
    tilt.target = Math.max(-MAX_TILT, Math.min(MAX_TILT, speed * TILT));
    const pts = pose({ pinch: pinch.step(dt), deg: tilt.step(dt) });
    applyPose(svg, pts);
    // Keep the index fingertip on the hotspot whatever the pose, and squash about it.
    const [tx, ty] = pts[INDEX_TIP];
    const ox = (tx - vx) * scale;
    const oy = (ty - vy) * scale;
    const k = squash.step(dt);
    el.style.transformOrigin = `${ox.toFixed(1)}px ${oy.toFixed(1)}px`;
    el.style.transform = `translate3d(${(x - ox).toFixed(1)}px, ${(y - oy + drag.step(dt)).toFixed(1)}px, 0) scale(${k.toFixed(3)})`;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  const inspect = (target: EventTarget | null) => {
    const node = target instanceof Element ? target : null;
    el.classList.toggle("over", !!node?.closest(CLICKABLE));
    el.classList.toggle("on-dark", isDark() || !!node?.closest(".theme-dark"));
  };

  let lastMove = performance.now();
  addEventListener(
    "pointermove",
    (e) => {
      if (e.pointerType !== "mouse") return;
      const now = performance.now();
      const v = (e.clientX - x) / Math.max(8, now - lastMove);
      // Ignore the jump from off-screen when the pointer first arrives.
      if (x > -100) speed = speed * 0.6 + v * 0.4;
      lastMove = now;
      x = e.clientX;
      y = e.clientY;
      el.classList.remove("hidden");
      inspect(e.target);
    },
    { passive: true },
  );
  // Leaving the window, or moving into an iframe such as the LinkedIn embed, which keeps its own cursor.
  document.addEventListener("pointerout", (e) => {
    if (!e.relatedTarget) el.classList.add("hidden");
  });

  addEventListener("pointerdown", (e) => {
    if (e.pointerType !== "mouse" || e.button !== 0) return;
    pressed = true;
    pinch.target = 1;
    squash.target = 0.9;
  });
  const release = () => {
    if (!pressed) return;
    pressed = false;
    pinch.target = 0;
    squash.target = 1;
    el.classList.remove("clicked");
    void el.offsetWidth; // restart the burst animation
    el.classList.add("clicked");
  };
  addEventListener("pointerup", release);
  addEventListener("pointercancel", release);

  addEventListener(
    "wheel",
    (e) => {
      if (!e.deltaY) return;
      const down = e.deltaY > 0;
      // Scrolling down moves the page up, so the hand grabs and drags upwards.
      pinch.target = 1;
      drag.target = down ? -DRAG : DRAG;
      el.classList.add("scrolling");
      el.classList.toggle("scroll-down", down);
      clearTimeout(scrollTimer);
      scrollTimer = window.setTimeout(() => {
        if (!pressed) pinch.target = 0;
        drag.target = 0;
        el.classList.remove("scrolling");
      }, RELEASE_MS);
    },
    { passive: true },
  );
  document.addEventListener("themechange", () => inspect(document.elementFromPoint(x, y)));
  // The page scrolling under a still pointer changes what the hand is over.
  addEventListener("scroll", () => inspect(document.elementFromPoint(x, y)), { passive: true });
}
