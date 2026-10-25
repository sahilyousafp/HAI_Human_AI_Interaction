import { randomUUID } from "node:crypto";
import type { AgentCamera, Message, SunSetting, ViewCamera, ViewRequest } from "@hai/protocol";

type Send = (message: Message) => void;

/** How long a viewer has to answer a capture request. */
export const CAPTURE_TIMEOUT_MS = 5000;

export type CaptureResult = { ok: true; png: string } | { ok: false; error: string };
export type ShotsResult =
  | { ok: true; shots: Array<{ camera: string; png: string; thumb: string }> }
  | { ok: false; error: string };

/** A connected page the bridge can send to alone. */
export interface Page {
  send(message: Message): void;
}

/**
 * What the user is looking at, for the agent: the element under the hand pointer and the camera, as the viewer
 * last reported them, and pictures of the view on request (answered by any open viewer).
 */
export class ViewContext {
  private pointedId: string | null = null;
  private cameraState: ViewCamera | null = null;
  private readonly pending = new Map<string, (result: CaptureResult) => void>();
  private readonly pendingShots = new Map<string, (result: ShotsResult) => void>();
  /** The pages that can be sent to alone, and the one the user used last (the one that renders agents' pictures). */
  private readonly pages = new Set<Page>();
  private active: Page | null = null;

  constructor(
    private readonly viewers: () => number,
    private readonly broadcast: Send,
    private readonly timeoutMs = CAPTURE_TIMEOUT_MS,
  ) {}

  get current(): { pointed: string | null; camera: ViewCamera | null } {
    return { pointed: this.pointedId, camera: this.cameraState };
  }

  /** A page connected: pictures for agents can be sent to it alone. Returns a function that removes it. */
  addPage(page: Page): () => void {
    this.pages.add(page);
    this.active ??= page;
    return () => {
      this.pages.delete(page);
      if (this.active === page) this.active = this.pages.values().next().value ?? null;
    };
  }

  /** The user did something in this page: it is the one to ask for pictures. */
  activate(page: Page): void {
    if (this.pages.has(page)) this.active = page;
  }

  /** Handles context and capture messages from a client. Returns false for other messages. */
  handle(message: Message): boolean {
    if (message.type === "context.update") {
      this.pointedId = message.payload.pointed;
      this.cameraState = message.payload.camera;
      return true;
    }
    if (message.type === "view.captured") {
      const shots = this.pendingShots.get(message.payload.requestId);
      if (shots) {
        this.pendingShots.delete(message.payload.requestId);
        shots(
          message.payload.shots
            ? { ok: true, shots: message.payload.shots }
            : { ok: false, error: message.payload.error ?? "The viewer could not take the pictures." },
        );
        return true;
      }
      const resolve = this.pending.get(message.payload.requestId);
      if (!resolve) return true; // another viewer answered first
      this.pending.delete(message.payload.requestId);
      resolve(
        message.payload.png
          ? { ok: true, png: message.payload.png }
          : { ok: false, error: message.payload.error ?? "The viewer could not capture the view." },
      );
      return true;
    }
    return false;
  }

  /** Asks every open viewer to move to a view; they animate there and give way at once to the user's own navigation. */
  setView(request: ViewRequest): { ok: true } | { ok: false; error: string } {
    if (this.viewers() === 0)
      return { ok: false, error: "No viewer is open, so the view cannot be changed." };
    this.broadcast({ type: "view.set", id: randomUUID(), payload: request });
    return { ok: true };
  }

  /** A PNG of the current view from an open viewer; with `sun`, the viewer's light is set to it first. */
  capture(sun?: SunSetting): Promise<CaptureResult> {
    if (this.viewers() === 0) {
      return Promise.resolve({ ok: false, error: "No viewer is open, so the view cannot be captured." });
    }
    const requestId = randomUUID();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        resolve({ ok: false, error: `The viewer did not answer within ${this.timeoutMs / 1000} seconds.` });
      }, this.timeoutMs);
      this.pending.set(requestId, (result) => {
        clearTimeout(timer);
        resolve(result);
      });
      this.broadcast({
        type: "view.capture",
        id: randomUUID(),
        payload: { requestId, ...(sun ? { sun } : {}) },
      });
    });
  }

  /**
   * Pictures from an agent's cameras, taken off-screen by one viewer (the one the user used last): the user's camera,
   * canvas and selection are not involved.
   */
  shoot(request: {
    agent: string;
    cameras: AgentCamera[];
    size: number;
    section: boolean;
    selection: boolean;
    sun?: SunSetting;
  }): Promise<ShotsResult> {
    if (this.viewers() === 0) {
      return Promise.resolve({ ok: false, error: "No viewer is open, so the view cannot be captured." });
    }
    const requestId = randomUUID();
    const timeoutMs = this.timeoutMs + 500 * request.cameras.length;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pendingShots.delete(requestId);
        resolve({
          ok: false,
          error: `The viewer did not answer within ${Math.round(timeoutMs / 1000)} seconds.`,
        });
      }, timeoutMs);
      this.pendingShots.set(requestId, (result) => {
        clearTimeout(timer);
        resolve(result);
      });
      const message: Message = {
        type: "view.capture",
        id: randomUUID(),
        payload: {
          requestId,
          agent: request.agent,
          cameras: request.cameras,
          size: request.size,
          options: { section: request.section, selection: request.selection },
          ...(request.sun ? { sun: request.sun } : {}),
        },
      };
      if (this.active) this.active.send(message);
      else this.broadcast(message);
    });
  }
}
