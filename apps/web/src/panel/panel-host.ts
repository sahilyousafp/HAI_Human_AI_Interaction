import { PANEL_MAX_MESSAGES_PER_SECOND, PanelEvent, type PanelQuery } from "@hai/protocol";
import type { FrameTheme } from "./frame-document.ts";
import type { PanelClient, PanelScene } from "./panel-client.ts";

/** At most this many elements come back from one `hai.scene.get`. */
export const PANEL_MAX_ELEMENTS = 200;
/** A document that has not reported itself loaded after this long is called failed. */
export const PANEL_LOAD_TIMEOUT_MS = 8000;

export interface PanelHostOptions {
  port: MessagePort;
  panelId: string;
  client: PanelClient;
  scene: PanelScene;
  now?: () => number;
  loadTimeoutMs?: number;
}

/**
 * The page's end of one panel's message port, and the only door a generated panel has: it checks every message
 * against the protocol's schemas, drops all but 60 per second, answers reads of the scene, and passes previews and
 * commits to the panel client. It sends the panel what changed (the scene, the selection, the theme) and what was
 * refused. Nothing the panel sends is trusted before it has passed `PanelEvent`.
 */
export class PanelHost {
  private readonly port: MessagePort;
  private readonly now: () => number;
  private windowStart = 0;
  private inWindow = 0;
  private droppedInWindow = false;
  private loadSettled = false;
  private loadTimer: ReturnType<typeof setTimeout> | null;
  private readonly offs: Array<() => void> = [];

  constructor(private readonly options: PanelHostOptions) {
    this.port = options.port;
    this.now = options.now ?? (() => performance.now());
    this.port.onmessage = (event) => this.receive(event.data);
    this.loadTimer = setTimeout(
      () => this.settleLoad(false, "The panel did not finish loading."),
      options.loadTimeoutMs ?? PANEL_LOAD_TIMEOUT_MS,
    );

    // What the panel is told as it happens: the scene changed, the selection changed, an operation was refused.
    let doc = options.scene.getSnapshot().doc;
    let selection = options.scene.getSnapshot().selection;
    this.offs.push(
      options.scene.subscribe(() => {
        const next = options.scene.getSnapshot();
        if (next.doc !== doc) {
          doc = next.doc;
          this.post({ type: "scene" });
        }
        if (next.selection !== selection) {
          selection = next.selection;
          this.post({ type: "selection", ids: selection });
        }
      }),
      options.client.onProblem((message) => this.post({ type: "problem", message })),
    );
    this.post({ type: "selection", ids: selection });
  }

  /** The app's theme changed (or the panel was just built): the panel's colours and tokens follow. */
  setTheme(theme: FrameTheme): void {
    this.post({ type: "theme", scheme: theme.scheme, vars: theme.vars });
  }

  /** A hand pressed, dragged or let go over the frame: the runtime acts on the control beneath the point. */
  press(phase: "down" | "move" | "up", x: number, y: number): void {
    this.post({ type: "press", phase, x, y });
  }

  dispose(): void {
    if (this.loadTimer) clearTimeout(this.loadTimer);
    this.loadTimer = null;
    for (const off of this.offs.splice(0)) off();
    this.port.onmessage = null;
    this.port.close();
  }

  private post(message: unknown): void {
    try {
      this.port.postMessage(message);
    } catch {
      // A closed port: the panel is gone.
    }
  }

  private receive(data: unknown): void {
    const now = this.now();
    if (now - this.windowStart >= 1000) {
      this.windowStart = now;
      this.inWindow = 0;
      this.droppedInWindow = false;
    }
    // A panel that sends a burst while it loads must still get to say it is ready (or that it failed).
    const lifecycle =
      typeof data === "object" &&
      data !== null &&
      ["ready", "error"].includes((data as { type?: string }).type ?? "");
    if (!lifecycle && ++this.inWindow > PANEL_MAX_MESSAGES_PER_SECOND) {
      // The first message dropped in a second is answered; the rest are dropped without a word.
      if (!this.droppedInWindow) {
        this.droppedInWindow = true;
        this.post({
          type: "problem",
          message: `Too many messages: at most ${PANEL_MAX_MESSAGES_PER_SECOND} per second are accepted, the rest are dropped.`,
        });
      }
      return;
    }
    const parsed = PanelEvent.safeParse(data);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
      this.post({
        type: "problem",
        message: `Invalid message. ${where}${issue?.message ?? "Not understood."}`,
      });
      return;
    }
    this.handle(parsed.data);
  }

  private handle(event: PanelEvent): void {
    const { client, panelId } = this.options;
    switch (event.type) {
      case "ready":
        this.settleLoad(true);
        return;
      case "error":
        if (!this.settleLoad(false, event.message)) client.failed(panelId, event.message);
        return;
      case "preview":
        client.setPreview(event.ops);
        return;
      case "commit":
        client.commit();
        return;
      case "get":
        this.post({
          type: "reply",
          requestId: event.requestId,
          result: this.read(event.query),
        });
        return;
      case "pressed":
        return;
      case "key":
        client.close();
        return;
    }
  }

  /** The first report decides whether the document loaded; false if it had been decided already. */
  private settleLoad(ok: boolean, reason?: string): boolean {
    if (this.loadSettled) return false;
    this.loadSettled = true;
    if (this.loadTimer) clearTimeout(this.loadTimer);
    this.loadTimer = null;
    this.options.client.loaded(this.options.panelId, ok, reason);
    return true;
  }

  /** The scene as the user sees it (the committed scene with the panel's own preview over it). */
  private read(query: PanelQuery): unknown {
    const doc = this.options.client.shownDoc(this.options.scene.getSnapshot().doc);
    if (!doc) return { elements: [] };
    let elements = query.ids
      ? query.ids.flatMap((id) => (doc.elements[id] ? [doc.elements[id]] : []))
      : Object.values(doc.elements);
    if (query.type) elements = elements.filter((e) => e.type === query.type);
    if (query.level) elements = elements.filter((e) => e.level === query.level);
    const notFound = query.ids?.filter((id) => !doc.elements[id]) ?? [];
    return {
      elements: elements.slice(0, PANEL_MAX_ELEMENTS),
      ...(elements.length > PANEL_MAX_ELEMENTS ? { truncated: true, total: elements.length } : {}),
      ...(notFound.length > 0 ? { notFound } : {}),
    };
  }
}
