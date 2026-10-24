import { FRAME_RUNTIME } from "./frame-runtime.ts";

/**
 * What a generated panel may do: run its own inline script and style, show data: images and fonts, and nothing else.
 * No network (connect-src), no outside resources (default-src), no forms, no nested frames. Set twice, as the
 * iframe's `csp` attribute (Chromium) and as the first element of the document (everywhere).
 */
export const FRAME_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; form-action 'none'; frame-src 'none'";

/**
 * The sandbox flags: scripts only. Without `allow-same-origin` the frame has an opaque origin, so it cannot read the
 * page, its storage or the session token; without `allow-forms`, `allow-popups`, `allow-modals` and
 * `allow-top-navigation` it cannot post a form, open a window, show a dialog or move the app.
 */
export const FRAME_SANDBOX = "allow-scripts";

/** The HUD's own tokens, which a panel can use and which follow the app's theme. */
export const THEME_VARIABLES = [
  "--panel",
  "--ink",
  "--muted",
  "--line",
  "--fill",
  "--fill-strong",
  "--accent",
  "--ok",
  "--warn",
  "--risk",
  "--r-s",
  "--r-m",
  "--f-body",
  "--f-mono",
] as const;

export interface FrameTheme {
  scheme: "light" | "dark";
  /** Token name to value (`--panel` to `#ffffff`). */
  vars: Record<string, string>;
}

/** A value from the app's own stylesheet, with anything that could end a rule or a tag removed. */
function safeValue(value: string): string {
  return value.replace(/[^\w\s#%.,()'"/-]/g, "").trim();
}

/** The app's current theme: its colour scheme and the HUD tokens as computed now. */
export function readTheme(root: HTMLElement = document.documentElement): FrameTheme {
  const css = getComputedStyle(root);
  const vars: Record<string, string> = {};
  for (const name of THEME_VARIABLES) {
    const value = safeValue(css.getPropertyValue(name));
    if (value) vars[name] = value;
  }
  return { scheme: matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light", vars };
}

/**
 * Base styles: a panel written with plain HTML looks like the rest of the HUD. Controls are sized for a fingertip,
 * since the user may drive the panel by hand.
 */
const BASE_STYLE = `
*, *::before, *::after { box-sizing: border-box; }
html { color-scheme: light dark; }
body {
  margin: 0;
  padding: 14px 16px 16px;
  background: var(--panel);
  color: var(--ink);
  font: 14px/1.4 var(--f-body, system-ui, sans-serif);
  -webkit-font-smoothing: antialiased;
}
h1, h2, h3 { margin: 0 0 8px; font-weight: 600; letter-spacing: -0.01em; }
h1 { font-size: 18px; } h2 { font-size: 16px; } h3 { font-size: 14px; }
p { margin: 0 0 10px; }
.muted, small { color: var(--muted); }
label { display: block; margin: 12px 0 4px; font-weight: 500; }
label:has(> input[type="checkbox"]), label:has(> input[type="radio"]) {
  display: flex; align-items: center; gap: 10px; min-height: 36px;
}
output { font-variant-numeric: tabular-nums; font-weight: 600; }
input[type="range"] { display: block; width: 100%; height: 36px; margin: 2px 0 6px; accent-color: var(--accent); }
input[type="number"], input[type="text"] {
  width: 100%; min-height: 40px; padding: 6px 10px; border: 1px solid var(--line); border-radius: var(--r-s, 8px);
  background: var(--fill); color: var(--ink); font: inherit;
}
input[type="checkbox"], input[type="radio"] { width: 24px; height: 24px; margin: 0; accent-color: var(--accent); }
button {
  min-height: 40px; min-width: 64px; padding: 6px 16px; border: 0; border-radius: var(--r-s, 8px);
  background: var(--accent); color: #fff; font: inherit; font-weight: 600; cursor: pointer;
}
button.secondary { background: var(--fill-strong, var(--fill)); color: var(--ink); }
button:disabled { opacity: 0.45; cursor: default; }
table { width: 100%; border-collapse: collapse; }
th, td { padding: 6px 4px; border-bottom: 1px solid var(--line); text-align: left; font-variant-numeric: tabular-nums; }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
`;

/** The CSS that makes the theme's tokens available to the panel's own styles. */
function themeStyle(theme: FrameTheme): string {
  const vars = Object.entries(theme.vars)
    .map(([name, value]) => `${name}:${safeValue(value)};`)
    .join("");
  return `:root{${vars}color-scheme:${theme.scheme};}`;
}

/**
 * The whole document the frame loads: the policy first, then the theme, the base styles and the runtime, then the
 * agent's document. The agent's `<html>`, `<head>` and `<body>` merge into these; it can add to the page but the
 * policy and the sandbox stay what they are.
 */
export function frameDocument(html: string, theme: FrameTheme): string {
  return [
    "<!doctype html>",
    `<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${FRAME_CSP}">`,
    `<meta name="viewport" content="width=device-width, initial-scale=1">`,
    `<html data-scheme="${theme.scheme}">`,
    `<style>${themeStyle(theme)}${BASE_STYLE}</style>`,
    `<script>${FRAME_RUNTIME}</script>`,
    html,
  ].join("\n");
}
