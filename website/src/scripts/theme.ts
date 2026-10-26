// Light and dark mode. The head script in Base.astro applies a saved choice before the first paint; this
// wires the header switch, keeps the browser's theme colour in step, and tells canvases to recolour by
// dispatching "themechange" on document.

const KEY = "hai-theme";
const root = document.documentElement;
const system = matchMedia("(prefers-color-scheme: dark)");

export const isDark = () => (root.dataset.theme ? root.dataset.theme === "dark" : system.matches);

const announce = () => {
  const dark = isDark();
  for (const b of document.querySelectorAll<HTMLButtonElement>("[data-theme-toggle]")) {
    b.setAttribute("aria-pressed", String(dark));
    b.setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
  }
  // With an explicit choice, both theme-color metas carry it; otherwise each follows its media query.
  for (const m of document.querySelectorAll<HTMLMetaElement>("[data-theme-color]")) {
    const showDark = root.dataset.theme ? dark : m.media.includes("dark");
    m.content = showDark ? "#0d0f12" : "#f4f5f7";
  }
  document.dispatchEvent(new Event("themechange"));
};

for (const b of document.querySelectorAll<HTMLButtonElement>("[data-theme-toggle]")) {
  b.addEventListener("click", () => {
    const next = isDark() ? "light" : "dark";
    root.dataset.theme = next;
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // Storage can be blocked; the switch still works for this page.
    }
    announce();
  });
}
system.addEventListener("change", () => {
  if (!root.dataset.theme) announce();
});
announce();
