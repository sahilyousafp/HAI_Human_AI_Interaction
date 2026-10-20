import type { Message, Point3Mm, ViewCamera } from "@aex/protocol";

/** Captured views are scaled down so their longest side is at most this many pixels. */
export const CAPTURE_MAX_SIDE = 1280;
/** Context updates are sent at most this often while the camera moves. */
const REPORT_MS = 200;

/** The size of a capture of a `width` x `height` canvas: never larger, longest side at most `maxSide`. */
export function captureSize(width: number, height: number, maxSide = CAPTURE_MAX_SIDE): [number, number] {
  const scale = Math.min(1, maxSide / Math.max(width, height, 1));
  return [Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale))];
}

/** A PNG of the canvas as base64 (no data URL prefix), scaled to `captureSize`. */
export async function canvasToPng(canvas: HTMLCanvasElement): Promise<string> {
  const [width, height] = captureSize(canvas.width, canvas.height);
  const out = document.createElement("canvas");
  out.width = width;
  out.height = height;
  const context = out.getContext("2d");
  if (!context) throw new Error("The browser could not prepare the image.");
  context.drawImage(canvas, 0, 0, width, height);
  const dataUrl = out.toDataURL("image/png");
  return dataUrl.slice(dataUrl.indexOf(",") + 1);
}

const round = (value: number, step: number) => Math.round(value / step) * step;

/**
 * The viewer's side of the agent's "eyes": tells the bridge what the user points at and how the camera looks
 * (millimetres, throttled, only when it changed), and answers the agent's requests for a picture of the view.
 */
export class ViewLink {
  private capturer: (() => Promise<string>) | null = null;
  private grounder: (() => Point3Mm | null) | null = null;
  private readonly pointedListeners = new Set<(id: string | null) => void>();
  private pointed: string | null = null;
  private camera: ViewCamera | null = null;
  private sent = "";
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly send: (message: Message) => boolean,
    private readonly reportMs = REPORT_MS,
  ) {}

  /** Registers how to capture the view; returns a function that unregisters it. */
  attachCapture(capture: () => Promise<string>): () => void {
    this.capturer = capture;
    return () => {
      if (this.capturer === capture) this.capturer = null;
    };
  }

  /** The element under the hand pointer, or null. */
  setPointed(id: string | null): void {
    if (id === this.pointed) return;
    this.pointed = id;
    for (const listener of this.pointedListeners) listener(id);
    this.schedule();
  }

  /** The element under the hand pointer now. */
  get pointedId(): string | null {
    return this.pointed;
  }

  /** Follows the element under the hand pointer (what a spoken "this" may mean). */
  onPointed(listener: (id: string | null) => void): () => void {
    this.pointedListeners.add(listener);
    return () => this.pointedListeners.delete(listener);
  }

  /** Registers how to find the ground point under the hand pointer; returns a function that unregisters it. */
  attachGround(ground: () => Point3Mm | null): () => void {
    this.grounder = ground;
    return () => {
      if (this.grounder === ground) this.grounder = null;
    };
  }

  /** Where the hand pointer meets the ground now (millimetres), if it is over the ground. */
  groundPoint(): Point3Mm | null {
    return this.grounder?.() ?? null;
  }

  setCamera(camera: ViewCamera): void {
    this.camera = {
      azimuth: round(camera.azimuth, 0.1),
      elevation: round(camera.elevation, 0.1),
      distance: round(camera.distance, 1),
      target: [round(camera.target[0], 1), round(camera.target[1], 1), round(camera.target[2], 1)],
    };
    this.schedule();
  }

  /** Handles capture requests; returns false for other messages. A fresh snapshot means a (re)connected bridge. */
  handle(message: Message): boolean {
    if (message.type === "scene.snapshot") {
      this.sent = ""; // the bridge may have restarted: tell it the context again
      this.schedule();
      return false; // the scene client handles the snapshot itself
    }
    if (message.type !== "view.capture") return false;
    void this.answer(message.payload.requestId);
    return true;
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private async answer(requestId: string): Promise<void> {
    const reply = (payload: { png: string } | { error: string }) =>
      this.send({ type: "view.captured", id: crypto.randomUUID(), payload: { requestId, ...payload } });
    if (!this.capturer) {
      reply({ error: "The viewer is still starting, so the view cannot be captured yet." });
      return;
    }
    try {
      reply({ png: await this.capturer() });
    } catch (error) {
      reply({ error: error instanceof Error ? error.message : "The viewer could not capture the view." });
    }
  }

  private schedule(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, this.reportMs);
  }

  private flush(): void {
    const payload = { pointed: this.pointed, camera: this.camera };
    const key = JSON.stringify(payload);
    if (key === this.sent) return;
    if (this.send({ type: "context.update", id: crypto.randomUUID(), payload })) this.sent = key;
  }
}
