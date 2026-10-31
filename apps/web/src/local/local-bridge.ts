import { type Message, parseScene, type SceneDocument, Settings } from "@hai/protocol";
import { SceneStore, type StoreResult } from "@hai/scene";
import sampleScene from "../../../bridge/samples/mixed-use-block.hai.json?raw";
import type { BridgeConnection, ConnectionState } from "../bridge/connection.ts";

/**
 * Whether this build runs on its own in the page (the "Try now" site): the scene is kept by `LocalBridge` in the tab, not
 * by the bridge on the user's computer. Nothing is saved, no agent runs, and no model files other than the tracking ones
 * are served.
 */
export const LOCAL_MODE = import.meta.env.VITE_HAI_LOCAL === "1";

/** The features that need a bridge, the agent or a download that is not shipped: off in the Try now build. */
const LOCAL_FEATURES = {
  agent: false,
  voice: false,
  openData: false,
  generatedPanels: false,
  parallelModelling: false,
} as const;

const id = (): string => crypto.randomUUID();

/** The model a visitor starts with: the sample building the bridge shows a new project. */
export function sampleDocument(): SceneDocument {
  const parsed = parseScene(JSON.parse(sampleScene));
  if (!parsed.ok) throw new Error(`The sample scene is not valid: ${parsed.error}`);
  return parsed.doc;
}

/**
 * What the bridge does for the scene, in the page: the same messages in and out (so the app and its tests are the same
 * code), the same `SceneStore` behind them, and imported models kept in memory instead of the project's assets folder.
 * Messages that are about the agent, Rhino, projects on disk or open data are not answered; the features that use them
 * are off.
 */
export class LocalBridge {
  private store: SceneStore;
  private readonly assets = new Map<string, Uint8Array>();
  private listener: ((message: Message) => void) | null = null;

  constructor(doc: SceneDocument = sampleDocument()) {
    this.store = new SceneStore(doc);
  }

  /** Keeps an imported model's converted geometry (the part of an import the bridge stores in assets/). */
  putAsset(assetId: string, bytes: Uint8Array): void {
    this.assets.set(assetId, bytes);
  }

  /** Where an imported model is "fetched" from: the app asks this for the address, `fetchAsset` answers it. */
  assetUrl = (_port: number, assetId: string): string => `local-asset:${assetId}`;

  /** A `fetch` that answers the addresses of `assetUrl` from memory. */
  fetchAsset = async (input: RequestInfo | URL): Promise<Response> => {
    const assetId = String(input).replace(/^local-asset:/, "");
    const bytes = this.assets.get(assetId);
    return bytes
      ? new Response(bytes as BodyInit, { status: 200 })
      : new Response(JSON.stringify({ error: "That model is not in this tab." }), { status: 404 });
  };

  /** The connection the app is given in place of the WebSocket: it is open at once and has one client, the tab. */
  connect(
    onState: (state: ConnectionState) => void,
    onMessage: (message: Message) => void,
  ): BridgeConnection {
    this.listener = onMessage;
    onState({ status: "connected", clients: 1, bridgeVersion: "in this tab" });
    // What a bridge sends a client that has just connected.
    this.emit({
      type: "settings.snapshot",
      id: id(),
      payload: Settings.parse({ palette: null, features: LOCAL_FEATURES }),
    });
    this.emit(this.snapshot());
    this.emit({ type: "project.status", id: id(), payload: { project: null, savedAt: null, error: null } });
    return {
      send: (message) => this.handle(message),
      close: () => {
        this.listener = null;
      },
    };
  }

  /** Answers a message from the app; false when it is not one a tab can answer (it is then dropped, as offline). */
  handle(message: Message): boolean {
    switch (message.type) {
      case "scene.apply":
        this.publish(this.store.apply(message.payload.label, message.payload.ops), message);
        return true;
      case "scene.undo":
        this.publish(this.store.undo(), message);
        return true;
      case "scene.redo":
        this.publish(this.store.redo(), message);
        return true;
      case "scene.resync":
        this.emit(this.snapshot());
        return true;
      case "selection.set":
        if (this.store.setSelection(message.payload.ids)) this.emitSelection();
        return true;
      case "project.open":
      case "project.create":
        this.emit({
          type: "request.error",
          id: id(),
          payload: {
            requestId: message.id,
            message: "Projects on disk are for the desktop app. Here, Save as 3dm keeps your work.",
          },
        });
        return true;
      default:
        return false;
    }
  }

  private publish(result: StoreResult, request: Message): void {
    if (!result.ok) {
      this.emit({
        type: "request.error",
        id: id(),
        payload: { requestId: request.id, message: result.error },
      });
      return;
    }
    this.emit({ type: "scene.patch", id: id(), payload: result.patch });
    if (result.selectionChanged) this.emitSelection();
  }

  private emitSelection(): void {
    this.emit({ type: "selection.changed", id: id(), payload: { ids: this.store.selection } });
  }

  private snapshot(): Message {
    return {
      type: "scene.snapshot",
      id: id(),
      payload: {
        seq: this.store.sequence,
        doc: this.store.doc,
        selection: this.store.selection,
        project: null,
        canUndo: this.store.canUndo,
        canRedo: this.store.canRedo,
      },
    };
  }

  /** Delivers after the caller has returned, as a socket would: the app is never re-entered from its own `send`. */
  private emit(message: Message): void {
    queueMicrotask(() => this.listener?.(message));
  }
}
