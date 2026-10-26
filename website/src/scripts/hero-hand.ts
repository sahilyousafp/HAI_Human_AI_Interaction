// The hero hand, drawn like HAI's tracking overlay (a teal landmark skeleton) but moved by a 3D rig
// (lib/rig.ts): it waves "Hi" once it has drawn itself in, turns to follow the pointer, pinches while the
// mouse is held, and plays a random gesture when clicked or after a quiet spell. With reduced motion it
// stays still.

import { applyPose, type Pt, reducedMotion, Spring } from "../lib/hand";
import { landmarks, orient, RELAXED, SHAPES, type Shape, type ShapeName } from "../lib/rig";

const stage = document.querySelector<HTMLElement>("[data-hand-stage]");
const svg = stage?.querySelector<SVGSVGElement>("[data-hand]");
const hi = stage?.querySelector<HTMLElement>("[data-hi]");
const letters = hi ? [...hi.querySelectorAll<HTMLElement>("span")] : [];

// Rig units to the SVG's viewBox: the wrist sits at the bottom centre, a few units of depth for perspective.
const SCALE = 34;
const ORIGIN_X = 200;
const ORIGIN_Y = 452;
const CAMERA = 28;

const project = (pts: ReturnType<typeof landmarks>): Pt[] =>
  pts.map(([x, y, z]) => {
    const f = CAMERA / (CAMERA - z);
    return [ORIGIN_X + x * SCALE * f, ORIGIN_Y - y * SCALE * f];
  });

if (stage && svg && hi) {
  // Even when still, the hand takes the rig's open pose, so it matches the moving one exactly.
  applyPose(svg, project(landmarks(SHAPES.open)));
}

if (stage && svg && hi && !reducedMotion()) {
  const SETTLE = 340;
  const springs = {
    thumbO: new Spring(0, SETTLE),
    thumbF: new Spring(0.15, SETTLE),
    fingers: Array.from({ length: 4 }, () => RELAXED.map((v) => new Spring(v, SETTLE))),
    spread: new Spring(1, SETTLE),
    roll: new Spring(0, 520),
    yaw: new Spring(0, 520),
  };
  // The greeting's letters, each on a slightly springy spring so they land with a little give.
  const letterSprings = letters.map(() => new Spring(0, 520, 0.62));
  const LETTER_GAP_MS = 140;
  const lookYaw = new Spring(0, 650);
  const lookPitch = new Spring(0, 650);

  const setShape = (name: ShapeName) => {
    const s = SHAPES[name];
    springs.thumbO.target = s.thumbO;
    springs.thumbF.target = s.thumbF;
    s.fingers.forEach((f, i) => {
      f.forEach((v, j) => {
        springs.fingers[i][j].target = v;
      });
    });
    springs.spread.target = s.spread;
    springs.roll.target = s.roll;
    springs.yaw.target = s.yaw;
  };

  // Timed moves layered on top of the springs.
  const WAVE_MS = 2400;
  const WAVE_PERIOD_MS = 640;
  const SPIN_MS = 1500;
  const WIGGLE_MS = 2200;
  const HOLD_MS = 1800;
  const IDLE_MS = 7000;
  // The bones finish drawing in at about this point; waving before then would smear the stroke animation.
  const FIRST_WAVE_MS = 1700;
  let waveAt = performance.now() + FIRST_WAVE_MS;
  let spinAt = -1e9;
  let wiggleAt = -1e9;
  let timers: number[] = [];
  const later = (ms: number, fn: () => void) => timers.push(window.setTimeout(fn, ms));
  const clearTimers = () => {
    for (const t of timers) clearTimeout(t);
    timers = [];
  };

  const ACTIONS: Record<string, () => void> = {
    wave: () => {
      setShape("open");
      waveAt = performance.now();
    },
    fist: () => setShape("fist"),
    point: () => setShape("point"),
    peace: () => setShape("peace"),
    ok: () => setShape("ok"),
    rock: () => setShape("rock"),
    callMe: () => setShape("callMe"),
    thumbsUp: () => setShape("thumbsUp"),
    count: () => {
      const steps: ShapeName[] = ["point", "peace", "three", "four", "open"];
      steps.forEach((s, i) => {
        later(i * 480, () => setShape(s));
      });
    },
    wiggle: () => {
      setShape("open");
      wiggleAt = performance.now();
    },
    spin: () => {
      setShape("open");
      spinAt = performance.now();
    },
  };
  const SEQUENCES = ["wave", "count", "wiggle", "spin"];
  let lastAction = "wave";
  let quietSince = performance.now();
  let held = false;
  const randomAction = () => {
    const names = Object.keys(ACTIONS).filter((n) => n !== lastAction);
    lastAction = names[Math.floor(Math.random() * names.length)];
    clearTimers();
    ACTIONS[lastAction]();
    // Hold a gesture, then relax back to an open hand.
    if (!SEQUENCES.includes(lastAction)) later(HOLD_MS, () => setShape("open"));
    quietSince = performance.now();
  };

  let frame = 0;
  let visible = true;
  let last = performance.now();

  const tick = (now: number) => {
    const dt = Math.min(64, now - last);
    last = now;
    if (!held && now - quietSince > IDLE_MS) randomAction();

    const s: Shape = {
      thumbO: springs.thumbO.step(dt),
      thumbF: springs.thumbF.step(dt),
      fingers: springs.fingers.map((f) => f.map((sp) => sp.step(dt))),
      spread: springs.spread.step(dt),
      roll: springs.roll.step(dt),
      yaw: springs.yaw.step(dt),
    };
    // Wiggle: each finger bends in turn, a ripple across the hand.
    const wt = now - wiggleAt;
    if (wt < WIGGLE_MS) {
      const env = Math.sin((Math.PI * wt) / WIGGLE_MS);
      s.fingers = s.fingers.map((f, i) => {
        const b = 45 * env * Math.max(0, Math.sin(wt / 110 - i * 0.9));
        return [f[0] + b, f[1] + b * 1.2, f[2] + b * 0.7];
      });
    }

    // Wave: the wrist swings inside an envelope that eases in and out, and the fingers trail a beat behind,
    // curling softly in rhythm, the way a real hand flops a little when it waves.
    const t = now - waveAt;
    let waveRoll = 0;
    if (t >= 0 && t < WAVE_MS) {
      const env = Math.sin((Math.PI * t) / WAVE_MS) ** 2;
      const phase = (2 * Math.PI * t) / WAVE_PERIOD_MS;
      waveRoll = 20 * env * Math.sin(phase);
      const trail = 7 * env * (1 + Math.sin(phase - 1.2));
      s.fingers = s.fingers.map(([a, b, c]) => [a + trail * 0.4, b + trail, c + trail * 0.6]);
    }
    // Greeting: the letters rise in one after the other as the wave starts, lean with the hand, and sink
    // away together as it settles.
    letterSprings.forEach((sp, i) => {
      const lt = t - 120 - i * LETTER_GAP_MS;
      sp.target = lt >= 0 && t < WAVE_MS - 150 ? 1 : 0;
      letters[i].style.setProperty("--a", sp.step(dt).toFixed(3));
    });
    hi.style.setProperty("--tilt", (waveRoll * -0.45).toFixed(2));
    const st = Math.min(1, (now - spinAt) / SPIN_MS);
    const spin = st < 1 ? 360 * (st < 0.5 ? 4 * st ** 3 : 1 - (-2 * st + 2) ** 3 / 2) : 0;
    const breathe = Math.sin(now / 1700);

    const pts = orient(
      landmarks(s),
      s.yaw + lookYaw.step(dt) + spin,
      lookPitch.step(dt) + breathe * 1.5,
      s.roll + waveRoll + breathe * 1.2,
    );
    applyPose(svg, project(pts));
    frame = visible ? requestAnimationFrame(tick) : 0;
  };
  const start = () => {
    if (frame) return;
    last = performance.now();
    frame = requestAnimationFrame(tick);
  };

  addEventListener(
    "pointermove",
    (e) => {
      const r = stage.getBoundingClientRect();
      const ox = (e.clientX - (r.left + r.width / 2)) / innerWidth;
      const oy = (e.clientY - (r.top + r.height / 2)) / innerHeight;
      lookYaw.target = Math.max(-38, Math.min(38, ox * 70));
      lookPitch.target = Math.max(-22, Math.min(22, oy * 40));
    },
    { passive: true },
  );
  document.addEventListener("pointerleave", () => {
    lookYaw.target = 0;
    lookPitch.target = 0;
  });
  // Holding the mouse anywhere else on the page: the hand pinches with you.
  addEventListener("pointerdown", (e) => {
    if (e.pointerType !== "mouse" || e.button !== 0 || stage.contains(e.target as Node)) return;
    held = true;
    clearTimers();
    setShape("ok");
  });
  const release = () => {
    if (!held) return;
    held = false;
    setShape("open");
    quietSince = performance.now();
  };
  addEventListener("pointerup", release);
  addEventListener("pointercancel", release);
  stage.addEventListener("click", randomAction);

  new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    if (visible) start();
  }).observe(stage);
  start();
}
