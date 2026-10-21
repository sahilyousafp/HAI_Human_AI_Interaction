import { pinchPoint } from "@aex/perception";
import { useEffect, useRef } from "react";
import { handClient, POINTER_GAIN, pointerSpace } from "../input/hand-mapping.ts";
import { type Capsule, handPieces, type Palm } from "./hand-geometry.ts";
import type { TrackingSession } from "./tracking-session.ts";

/** How opaque the drawn hands are: solid enough to read over any panel, with the interface still showing through. */
export const HAND_OPACITY = 0.88;

function capsulePath(ctx: CanvasRenderingContext2D, c: Capsule): void {
  const [ax, ay] = c.a;
  const [bx, by] = c.b;
  const ra = c.widthA / 2;
  const rb = c.widthB / 2;
  const angle = Math.atan2(by - ay, bx - ax);
  ctx.beginPath();
  ctx.arc(ax, ay, ra, angle + Math.PI / 2, angle + (3 * Math.PI) / 2);
  ctx.arc(bx, by, rb, angle - Math.PI / 2, angle + Math.PI / 2);
  ctx.closePath();
}

function palmPath(ctx: CanvasRenderingContext2D, p: Palm): void {
  ctx.beginPath();
  for (const [i, [x, y]] of p.points.entries()) {
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

/**
 * Show my hands: the user's hands drawn as solid white shapes over the whole screen, at their pointers, so people
 * watching a recording can see what the hands do. Drawn every animation frame from the tracked landmarks (never the
 * camera image), it never takes input: pointers, presses and scrolls go straight through.
 */
export function HandOverlay({ session, on }: { session: TrackingSession; on: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !on) return;
    // The hands are first drawn opaque on their own layer, then laid over the page in one go, so overlapping
    // fingers never show darker seams.
    const layer = document.createElement("canvas");
    const layerCtx = layer.getContext("2d");
    if (!layerCtx) return;
    let raf = 0;
    const fit = () => {
      const dpr = devicePixelRatio || 1;
      for (const c of [canvas, layer]) {
        c.width = Math.round(innerWidth * dpr);
        c.height = Math.round(innerHeight * dpr);
      }
      layerCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    fit();
    addEventListener("resize", fit);
    const tick = () => {
      raf = requestAnimationFrame(tick);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const frame = session.latestFrame;
      const ws = pointerSpace();
      if (!frame || frame.hands.length === 0) return;
      layerCtx.clearRect(0, 0, innerWidth, innerHeight);
      const aspect = frame.aspect ?? 4 / 3;
      // One even white for the whole hand, so it reads as one shape; depth shows in the finger widths and shadow.
      layerCtx.fillStyle = "#ffffff";
      layerCtx.strokeStyle = "#ffffff";
      layerCtx.lineJoin = "round";
      for (const hand of frame.hands) {
        const anchor = handClient(pinchPoint(hand), ws);
        for (const piece of handPieces(hand, anchor, ws.height * POINTER_GAIN, aspect)) {
          if (piece.kind === "palm") {
            palmPath(layerCtx, piece);
            // A thick round outline softens the palm's corners into the fingers.
            layerCtx.lineWidth = piece.roundness;
            layerCtx.stroke();
          } else {
            capsulePath(layerCtx, piece);
          }
          layerCtx.fill();
        }
      }
      // A soft light from above gives the flat white a little volume.
      layerCtx.globalCompositeOperation = "source-atop";
      const shade = layerCtx.createLinearGradient(0, 0, 0, innerHeight);
      shade.addColorStop(0, "rgb(255 255 255 / 0)");
      shade.addColorStop(1, "rgb(200 205 214 / 0.35)");
      layerCtx.fillStyle = shade;
      layerCtx.fillRect(0, 0, innerWidth, innerHeight);
      layerCtx.globalCompositeOperation = "source-over";
      const dpr = devicePixelRatio || 1;
      ctx.save();
      ctx.globalAlpha = HAND_OPACITY;
      // A soft drop shadow lifts the hands off the page and outlines them on light panels.
      ctx.shadowColor = "rgb(0 0 0 / 0.34)";
      ctx.shadowBlur = 14 * dpr;
      ctx.shadowOffsetY = 4 * dpr;
      ctx.drawImage(layer, 0, 0);
      ctx.restore();
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      removeEventListener("resize", fit);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    };
  }, [session, on]);

  if (!on) return null;
  return <canvas ref={canvasRef} className="hand-overlay" data-testid="hand-overlay" />;
}
