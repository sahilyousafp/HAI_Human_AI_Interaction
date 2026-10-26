// Header behaviour: blur/hairline once scrolled, scroll-spy underline, flipping EN/HI logo, and the "HAI"
// that opens into its full name in step with the flip.

import { initBrand } from "./brand";

const hdr = document.querySelector<HTMLElement>("[data-hdr]");
const sentinel = document.querySelector<HTMLElement>("[data-sentinel]");
if (hdr && sentinel) {
  new IntersectionObserver(([e]) => hdr.classList.toggle("scrolled", !e.isIntersecting)).observe(sentinel);
}

// Logo flip. "HAI" opens while the logo shows its Hindi face and folds back with the English one.
const logo = document.querySelector<HTMLElement>("[data-logo]");
const brand = initBrand();
if (logo) {
  let timer = 0;
  const start = () => {
    clearInterval(timer);
    timer = window.setInterval(() => brand?.follow(logo.classList.toggle("is-flipped")), 3500);
  };
  document.addEventListener("visibilitychange", () => (document.hidden ? clearInterval(timer) : start()));
  start();
}

// Scroll spy over the sections that have a nav link.
const links = [...document.querySelectorAll<HTMLAnchorElement>("[data-nav]")];
const sections = [...document.querySelectorAll<HTMLElement>("[data-spy]")];
let current = "";

function spy() {
  const line = innerHeight * 0.35;
  let id = "";
  for (const s of sections) {
    const r = s.getBoundingClientRect();
    if (r.top <= line && r.bottom > line) id = s.dataset.spy ?? "";
  }
  if (id === current) return;
  current = id;
  for (const a of links) a.classList.toggle("active", a.dataset.nav === id);
}

let ticking = false;
addEventListener(
  "scroll",
  () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      spy();
    });
  },
  { passive: true },
);
addEventListener("resize", spy);
spy();
