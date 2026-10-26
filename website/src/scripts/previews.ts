// Card previews loop like GIFs while they are on screen and stop when they are not, so only the visible
// ones download and decode. With reduced motion they stay on their still and play only while hovered.

const previews = [...document.querySelectorAll<HTMLVideoElement>("[data-preview]")];
const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;

const play = (v: HTMLVideoElement) => {
  // Autoplay can be refused (e.g. battery saver); the poster still shows, so there is nothing to handle.
  v.play().catch(() => {});
};

if (calm) {
  for (const v of previews) {
    const card = v.closest<HTMLElement>("[data-card]");
    card?.addEventListener("pointerenter", () => play(v));
    card?.addEventListener("pointerleave", () => v.pause());
  }
} else if ("IntersectionObserver" in window) {
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        const v = e.target as HTMLVideoElement;
        if (e.isIntersecting) play(v);
        else v.pause();
      }
    },
    { threshold: 0.35 },
  );
  for (const v of previews) io.observe(v);
}

export {};
