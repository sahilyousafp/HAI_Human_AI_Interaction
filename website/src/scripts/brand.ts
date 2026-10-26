// "HAI" in the header unfolds into "Human AI Interface": a tiny hand appears on the end of the word,
// pinches it, and drags right while each letter's tail slides out; it folds back the same way. It follows the
// logo flip, and hovering the brand opens it and holds it open.

import { applyPose, pose, reducedMotion } from "../lib/hand";

const GRAB_MS = 200;
// Matches the .tail max-width transition in Header.astro.
const DRAG_MS = 720;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function tweenPinch(svg: SVGSVGElement, from: number, to: number, ms: number) {
  return new Promise<void>((resolve) => {
    const t0 = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / ms);
      const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
      applyPose(svg, pose({ pinch: from + (to - from) * e }));
      if (t < 1) requestAnimationFrame(step);
      else resolve();
    };
    requestAnimationFrame(step);
  });
}

export function initBrand() {
  const link = document.querySelector<HTMLElement>("[data-brand]");
  const root = document.querySelector<HTMLElement>("[data-hai]");
  const svg = root?.querySelector<SVGSVGElement>("[data-hand]");
  if (!link || !root || !svg) return null;

  // On a phone the full name would push the header's GitHub link off screen.
  const roomy = matchMedia("(width > 560px)");
  const calm = reducedMotion();
  let open = false;
  let logoOpen = false;
  let hovered = false;
  let run = 0;

  const measure = () => {
    for (const t of root.querySelectorAll<HTMLElement>(".tail"))
      t.style.setProperty("--w", `${t.scrollWidth}px`);
  };
  void document.fonts.ready.then(measure);

  const set = async (want: boolean) => {
    if (want === open) return;
    open = want;
    const id = ++run;
    if (calm) {
      root.classList.toggle("open", want);
      return;
    }
    root.classList.add("grab");
    await tweenPinch(svg, 0, 1, GRAB_MS);
    if (id !== run) return;
    root.classList.toggle("open", want);
    await sleep(DRAG_MS);
    if (id !== run) return;
    await tweenPinch(svg, 1, 0, GRAB_MS);
    if (id === run) root.classList.remove("grab");
  };

  const sync = () => set(roomy.matches && (hovered || logoOpen));
  link.addEventListener("pointerenter", () => {
    hovered = true;
    sync();
  });
  link.addEventListener("pointerleave", () => {
    hovered = false;
    sync();
  });
  link.addEventListener("focus", () => {
    hovered = true;
    sync();
  });
  link.addEventListener("blur", () => {
    hovered = false;
    sync();
  });
  roomy.addEventListener("change", sync);

  return {
    /** Called on each logo flip with whether the logo now shows its Hindi face. */
    follow(flipped: boolean) {
      logoOpen = flipped;
      sync();
    },
  };
}
