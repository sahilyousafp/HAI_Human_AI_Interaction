import type { HostId } from "@hai/protocol";

/**
 * Each host's icon: a plain shape for what it does best, never the vendor's logo. Rhino is a NURBS patch with its
 * isocurves (form), Blender a lit sphere (render), Revit a building section with its levels (BIM).
 */
const PATHS: Record<HostId, string[]> = {
  rhino: ["M3 17c3-7 8-10 13-10l5 3c-5 0-10 3-13 10z", "M7.5 15.5c2.5-4.5 6-6.8 9.8-7", "M10.5 12.5l4.7 3.1"],
  blender: [
    "M18 13a7 7 0 1 1-14 0a7 7 0 0 1 14 0z",
    "M8 10.5a3.5 3.5 0 0 1 3-1.8",
    "M17.5 4.5l-2 2M20 7l-2.6.6M14.6 2.6l-.6 2.6",
  ],
  revit: ["M4 20V8l8-4 8 4v12", "M4 12h16M4 16h16", "M10 20v-4h4v4"],
};

export function HostGlyph({ host, size = 16 }: { host: HostId; size?: number }) {
  return (
    <svg
      className="host-glyph"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      data-glyph={host}
    >
      {PATHS[host].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
