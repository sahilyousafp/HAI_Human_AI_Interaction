// Fade and lift elements in as they enter the viewport. Runs once per element.

const items = [...document.querySelectorAll<HTMLElement>(".rv")];
if (matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) {
  for (const el of items) el.classList.add("in");
} else {
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.classList.add("in");
        io.unobserve(e.target);
      }
    },
    { rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
  );
  for (const el of items) io.observe(el);
}

export {};
