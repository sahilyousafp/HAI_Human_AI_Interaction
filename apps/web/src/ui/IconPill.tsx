import type { ReactNode } from "react";

/** The top bar's own icons, drawn in the same 24-unit grid and stroke as the host icons. */
const ICONS = {
  camera: [
    "M3 8.5A1.5 1.5 0 0 1 4.5 7H7l1.5-2h7L17 7h2.5A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z",
    "M15.5 13a3.5 3.5 0 1 1-7 0a3.5 3.5 0 0 1 7 0z",
  ],
  cameraOff: [
    "M3 8.5A1.5 1.5 0 0 1 4.5 7H7l1.5-2h7L17 7h2.5A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z",
    "M4 4l16 16",
  ],
  mic: ["M12 3a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3z", "M6 11a6 6 0 0 0 12 0M12 17v4"],
  micOff: [
    "M12 3a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3z",
    "M6 11a6 6 0 0 0 12 0M12 17v4",
    "M4 4l16 16",
  ],
  bridge: [
    "M9 15l6-6",
    "M10.5 6.5l1.8-1.8a4 4 0 0 1 5.7 5.7l-1.8 1.8",
    "M13.5 17.5l-1.8 1.8a4 4 0 0 1-5.7-5.7l1.8-1.8",
  ],
} as const;
export type PillIcon = keyof typeof ICONS;

export function PillGlyph({ icon, size = 16 }: { icon: PillIcon; size?: number }) {
  return (
    <svg
      className="pill-glyph"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICONS[icon].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

/**
 * A compact status pill of the top bar: an icon with its state as a dot in the corner, and a number or short note
 * beside it. The words are its tooltip and what a screen reader says. While the state needs the user (`showText`),
 * the words are shown too, so trouble is never hidden behind an icon.
 */
export function IconPill({
  testId,
  className = "",
  state,
  glyph,
  text,
  meta,
  showText = false,
  title,
  extra,
}: {
  testId: string;
  className?: string;
  state: string;
  glyph: ReactNode;
  text: string;
  meta?: ReactNode;
  showText?: boolean;
  title?: string;
  /** Data attributes or anything else the pill carries for its own tests. */
  extra?: Record<string, string>;
}) {
  return (
    <output
      className={`status icon-pill ${className}`.trim()}
      data-testid={testId}
      data-state={state}
      title={title ?? text}
      aria-live="polite"
      {...extra}
    >
      <span className="icon-pill-icon">
        {glyph}
        <span className="dot" aria-hidden="true" />
      </span>
      <span className={showText ? "icon-pill-text" : "visually-hidden"} data-testid={`${testId}-text`}>
        {text}
      </span>
      {meta}
    </output>
  );
}
