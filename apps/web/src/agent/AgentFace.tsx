import type { CSSProperties } from "react";

/** What an agent is doing, as its face shows it. */
export type FaceState = "idle" | "working" | "queued" | "waiting";

/** The roles the default team has a face for; any other agent gets the generic one. */
export type FaceRole = "architect" | "climate" | "product" | "reviewer" | "simulation" | "urban" | "generic";

const ROLES: readonly FaceRole[] = ["architect", "climate", "product", "reviewer", "simulation", "urban"];

/** The face an agent wears: by its name (a worker, `architect.2`, wears its specialist's). */
export function roleOf(name: string): FaceRole {
  const base = name.toLowerCase().replace(/\.\d+$/, "");
  return ROLES.find((role) => role === base) ?? "generic";
}

/** Marks worn on the face (a hat, glasses) are drawn over it; the others sit behind the head. */
const WORN: ReadonlySet<FaceRole> = new Set(["architect", "reviewer"]);

/** The role's own mark, drawn around the head. Each is animated by what the agent is doing (see styles.css). */
function Accessory({ role }: { role: FaceRole }) {
  switch (role) {
    case "architect":
      // A hard hat that nods while it works.
      return (
        <g className="face-acc face-hat">
          <path d="M11 17.5 Q20 5.5 29 17.5 Z" fill="#f2b01e" />
          <rect x="9" y="16.6" width="22" height="2.4" rx="1.2" fill="#d99a10" />
          <rect x="18.6" y="9.4" width="2.8" height="5" rx="1" fill="#ffd45e" />
        </g>
      );
    case "climate":
      // A sun with rays that turn.
      return (
        <g className="face-acc face-sun">
          <g className="face-rays" stroke="#ffd166" strokeWidth="1.4" strokeLinecap="round">
            <path d="M31.5 4.2v2M31.5 11.8v2M25.7 9h2M35.3 9h2M27.4 4.9l1.4 1.4M34.2 11.7l1.4 1.4M35.6 4.9l-1.4 1.4M28.8 11.7l-1.4 1.4" />
          </g>
          <circle cx="31.5" cy="9" r="2.6" fill="#ffd166" />
        </g>
      );
    case "product":
      // A small cube that bobs and turns.
      return (
        <g className="face-acc face-cube">
          <path d="M6.5 8.2 11 6l4.5 2.2L11 10.4Z" fill="#fff3" />
          <path d="M6.5 8.2 11 10.4V15L6.5 12.8Z" fill="#0003" />
          <path d="M15.5 8.2 11 10.4V15l4.5-2.2Z" fill="#0005" />
        </g>
      );
    case "reviewer":
      // Round glasses with a glint that sweeps across.
      return (
        <g className="face-acc face-glasses" fill="none" stroke="#101618" strokeWidth="1.3">
          <circle cx="15.6" cy="21" r="3.9" />
          <circle cx="24.4" cy="21" r="3.9" />
          <path d="M19.5 21h1M11.7 20.2 9.6 19.4M28.3 20.2l2.1-.8" strokeLinecap="round" />
          <path
            className="face-glint"
            d="M13.6 19.2 16 22.6"
            stroke="#fff"
            strokeWidth="1.1"
            strokeLinecap="round"
          />
        </g>
      );
    case "simulation":
      // An orbit with a dot that circles the head.
      return (
        <g className="face-acc face-orbit">
          <ellipse
            cx="20"
            cy="21"
            rx="16.5"
            ry="5.6"
            fill="none"
            stroke="#fff"
            strokeOpacity=".55"
            strokeWidth="1.1"
          />
          <g className="face-satellite">
            <circle cx="36.5" cy="21" r="2" fill="#fff" />
          </g>
        </g>
      );
    case "urban":
      // A skyline under the chin whose windows light up.
      return (
        <g className="face-acc face-skyline">
          <path d="M8 36V30h4v6M13 36V27h5v9M19 36V31h4v5M24 36V28h5v8M30 36V31h3v5" fill="#0004" />
          <g fill="#ffe08a">
            <rect className="face-window" x="14.5" y="29" width="1" height="1.2" />
            <rect className="face-window w2" x="25.5" y="30" width="1" height="1.2" />
            <rect className="face-window w3" x="20.5" y="33" width="1" height="1.2" />
          </g>
        </g>
      );
    default:
      // An antenna whose bead glows while it works.
      return (
        <g className="face-acc face-antenna">
          <path d="M20 12.6V7" stroke="#101618" strokeWidth="1.3" strokeLinecap="round" />
          <circle className="face-bead" cx="20" cy="6" r="2" fill="#fff" />
        </g>
      );
  }
}

/**
 * An agent as a small face in its colour, with the mark of its role (a hard hat, a sun, a cube, glasses, an orbit, a
 * skyline). The face shows what the agent is doing: resting with slow blinks, busy with darting eyes and a moving mark,
 * asleep while it queues, and startled with a question mark when it waits for the user. The motion is in styles.css and
 * stops for people who ask for less.
 */
export function AgentFace({ name, state, color }: { name: string; state: FaceState; color: string }) {
  const role = roleOf(name);
  return (
    <svg
      className="agent-face"
      data-role={role}
      data-state={state}
      viewBox="0 0 40 40"
      width="40"
      height="40"
      role="img"
      aria-hidden="true"
      style={{ "--face": color } as CSSProperties}
    >
      <circle className="face-disc" cx="20" cy="20" r="19" />
      {!WORN.has(role) && <Accessory role={role} />}
      <circle className="face-head" cx="20" cy="22" r="10.5" />
      <g className="face-brows" stroke="#101618" strokeWidth="1.2" strokeLinecap="round">
        <path className="face-brow l" d="M13.6 15.6 17.4 15" />
        <path className="face-brow r" d="M22.6 15 26.4 15.6" />
      </g>
      <g className="face-eyes" fill="#101618">
        <ellipse className="face-eye" cx="16.2" cy="21" rx="1.5" ry="2" />
        <ellipse className="face-eye" cx="23.8" cy="21" rx="1.5" ry="2" />
      </g>
      {WORN.has(role) && <Accessory role={role} />}
      <path
        className="face-mouth m-smile"
        d="M16.4 26.6q3.6 3 7.2 0"
        fill="none"
        stroke="#101618"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
      <path
        className="face-mouth m-flat"
        d="M17.4 27.4h5.2"
        fill="none"
        stroke="#101618"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
      <ellipse className="face-mouth m-o" cx="20" cy="27.4" rx="1.7" ry="2.1" fill="#101618" />
      <g className="face-zzz" fill="#fff" fontFamily="system-ui, sans-serif" fontWeight="700">
        <text className="z1" x="28" y="12" fontSize="6">
          z
        </text>
        <text className="z2" x="32" y="7" fontSize="5">
          z
        </text>
      </g>
      <g className="face-ask">
        <circle cx="31.5" cy="9.5" r="5.6" fill="var(--warn)" />
        <text
          x="31.5"
          y="12.4"
          textAnchor="middle"
          fontSize="8.5"
          fontWeight="800"
          fill="#fff"
          fontFamily="system-ui, sans-serif"
        >
          ?
        </text>
      </g>
    </svg>
  );
}
