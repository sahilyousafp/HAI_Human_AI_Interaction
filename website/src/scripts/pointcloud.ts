// Hero background: the spairl.si contour landscape, seen as a point cloud, the way a site scan arrives.
// A seeded height field of soft hills is sampled on a grid, drifts slowly, and is projected in perspective.
// The pointer raises a soft bump that tints the points it lifts, and a click sends a ripple out across the
// ground. Colours come from the theme tokens, so it follows light and dark mode.

const COLS = 176;
const ROWS = 96;
// World extents: x across, z into the screen. Heights are in the same units.
const SPAN_X = 3.4;
// NEAR reaches past the bottom of the hero so the ground runs out towards the viewer.
const NEAR = 0.75;
const FAR = 7;
// Rows beyond this shimmer into moiré at screen size, so they are left out; the ground is densest at PEAK
// and fades both ways from there: into the horizon and, slowly, towards the viewer.
const CUTOFF = 5.6;
const PEAK = 1.55;
const EYE_H = 1.15;
const BUMP_R = 120; // px
const RIPPLE_MS = 1600;

export function initPointCloud(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let w = 0;
  let h = 0;
  let dpr = 1;
  let visible = true;
  let raf = 0;
  let ink = "#16181c";
  let accent = "#0b3bd6";

  // Seeded so the landscape is the same on every visit, like spairl.si's.
  let seed = 11;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const hills = Array.from({ length: 9 }, (_, i) => ({
    x: (rnd() - 0.35) * SPAN_X * 1.2,
    z: NEAR + rnd() * (FAR - NEAR),
    a: (rnd() * 0.25 + 0.12) * (i % 3 === 0 ? -0.6 : 1),
    s: 0.35 + rnd() * 0.55,
  }));
  const base = new Float32Array(COLS * ROWS);
  for (let j = 0; j < ROWS; j++) {
    const z = NEAR + ((FAR - NEAR) * j) / (ROWS - 1);
    for (let i = 0; i < COLS; i++) {
      const x = -SPAN_X + (2 * SPAN_X * i) / (COLS - 1);
      let v = 0.05 * Math.sin(x * 2.1 + z * 0.8) * Math.cos(z * 1.7 - x * 0.6);
      for (const p of hills) v += p.a * Math.exp(-((x - p.x) ** 2 + (z - p.z) ** 2) / (2 * p.s * p.s));
      base[j * COLS + i] = v;
    }
  }

  const pointer = { x: -9999, y: -9999, amp: 0, target: 0 };
  const ripples: { x: number; y: number; at: number }[] = [];
  const lifted: number[] = [];

  const readTheme = () => {
    const css = getComputedStyle(document.documentElement);
    ink = css.getPropertyValue("--graphite").trim() || ink;
    accent = css.getPropertyValue("--accent").trim() || accent;
  };

  const size = () => {
    const r = canvas.getBoundingClientRect();
    w = r.width;
    h = r.height;
    dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  };

  const draw = (now: number) => {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    pointer.amp += (pointer.target - pointer.amp) * 0.08;
    const t = calm ? 0 : now / 1000;
    const focal = w * 0.55;
    const horizon = h * 0.34;
    const cx = w * 0.62;
    const live = ripples.filter((r) => now - r.at < RIPPLE_MS);
    ripples.length = 0;
    ripples.push(...live);
    lifted.length = 0;

    // Far rows first, so nearer points draw over them.
    for (let j = ROWS - 1; j >= 0; j--) {
      const z = NEAR + ((FAR - NEAR) * j) / (ROWS - 1);
      const k = focal / z;
      if (z > CUTOFF) continue;
      // 0 at the cut-off, 1 at the peak and nearer.
      const depth = Math.min(1, (CUTOFF - z) / (CUTOFF - PEAK));
      const near = Math.min(1, (z - NEAR) / (PEAK - NEAR));
      const fadeIn = near * near * (3 - 2 * near);
      ctx.globalAlpha = 0.5 * depth ** 1.4 * fadeIn;
      if (ctx.globalAlpha < 0.01) continue;
      ctx.fillStyle = ink;
      const s = 0.7 + 1.5 * depth + 0.8 * (1 - near);
      for (let i = 0; i < COLS; i++) {
        const x = -SPAN_X + (2 * SPAN_X * i) / (COLS - 1);
        let y = base[j * COLS + i] + 0.035 * Math.sin(x * 2.6 + t * 0.6) * Math.cos(z * 1.9 - t * 0.45);
        const sx = cx + x * k;
        let sy = horizon + (EYE_H - y) * k * 0.62;
        // Pointer bump and click ripples act in screen space, so they sit exactly under the hand.
        let lift = 0;
        if (pointer.amp > 0.01) {
          const d2 = (sx - pointer.x) ** 2 + (sy - pointer.y) ** 2;
          lift += pointer.amp * 26 * Math.exp(-d2 / (2 * BUMP_R * BUMP_R));
        }
        for (const r of ripples) {
          const age = (now - r.at) / RIPPLE_MS;
          const d = Math.hypot(sx - r.x, sy - r.y) - age * 520;
          lift += 14 * (1 - age) * Math.exp(-(d * d) / 900);
        }
        if (lift) {
          sy -= lift * depth;
          y += lift;
        }
        if (sx < -4 || sx > w + 4 || sy < -4 || sy > h + 4) continue;
        if (lift > 6) lifted.push(sx, sy, s, Math.min(1, lift / 20));
        else ctx.fillRect(sx, sy, s, s);
      }
    }
    // Lifted points in the accent colour, on top.
    ctx.fillStyle = accent;
    for (let n = 0; n < lifted.length; n += 4) {
      ctx.globalAlpha = 0.35 + 0.55 * lifted[n + 3];
      const s = lifted[n + 2] * 1.25;
      ctx.fillRect(lifted[n], lifted[n + 1], s, s);
    }
    ctx.globalAlpha = 1;
  };

  const loop = (now: number) => {
    draw(now);
    raf = visible && !calm ? requestAnimationFrame(loop) : 0;
  };
  const start = () => {
    if (!raf && !calm) raf = requestAnimationFrame(loop);
  };

  readTheme();
  size();
  draw(performance.now());
  canvas.classList.add("ready");

  new ResizeObserver(() => {
    size();
    draw(performance.now());
  }).observe(canvas);
  new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    if (visible) start();
  }).observe(canvas);
  document.addEventListener("themechange", () => {
    readTheme();
    draw(performance.now());
  });

  if (!calm) {
    const local = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top] as const;
    };
    addEventListener(
      "pointermove",
      (e) => {
        [pointer.x, pointer.y] = local(e);
        pointer.target = pointer.y < h ? 1 : 0;
      },
      { passive: true },
    );
    document.addEventListener("pointerleave", () => {
      pointer.target = 0;
    });
    addEventListener("pointerdown", (e) => {
      const [x, y] = local(e);
      if (y < h) ripples.push({ x, y, at: performance.now() });
    });
    start();
  }
}
