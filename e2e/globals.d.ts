// Dev-build hooks the app exposes for end-to-end tests (declared in the app; repeated here for the e2e typecheck).
type E2EPoint = [number, number];
type E2EGesture = { type: string; ts: number; confidence: number; [key: string]: unknown };

interface Window {
  /** The camera session: the overlay draws `latestFrame` (landmarks only). */
  __HAI_CAMERA__?: { latestFrame: unknown };
  __HAI_VIEWER__?: {
    camera(): { target: [number, number, number]; azimuth: number; elevation: number; distance: number };
    meshCount(): number;
    pick(x: number, y: number): string | null;
    latencyP90(): number | null;
    hovered?(): string | null;
    wear?(id: string): { color: string; outline: string | null; glow: string | null } | null;
    claimBoxes?(): string[];
    cameraMarkers?(): string[];
    renders(): number;
    project(point: [number, number, number]): [number, number];
    overSection(x: number, y: number): boolean;
    sectionOutline(): Array<[number, number]>;
    sun(): { altitude: number; azimuth: number; label: string } | null;
    handAt(x: number, y: number): [number, number];
  };
  __HAI_INPUT__?: {
    // biome-ignore lint/suspicious/noExplicitAny: tests build events loosely; the app validates their shape.
    gestures(events: any[]): void;
    /** The right hand's pinch point, and the left hand's. */
    pointer(
      right: E2EPoint | null,
      left?: E2EPoint | null,
      closing?: { Left?: boolean; Right?: boolean },
    ): void;
    engaged(engaged: boolean): void;
  };
  __HAI_SCENE__?: {
    apply(label: string, ops: unknown[]): boolean;
    select(ids: string[]): void;
    undo(): boolean;
    redo(): boolean;
    getSnapshot(): {
      doc: { elements: Record<string, Record<string, unknown>> } | null;
      selection: string[];
      canUndo: boolean;
      canRedo: boolean;
      lastChange: { kind: string; label: string; at: number } | null;
    };
  };
  /** The generated panel client: `shownDoc` is the scene with the open panel's preview laid over it. */
  __HAI_PANELS__?: {
    shownDoc(
      doc: unknown,
    ): { elements: Record<string, { type: string; position?: [number, number] }> } | null;
  };
  /** The Rhino mirror: what Rhino reported, and how long its changes took to be drawn. */
  __HAI_MIRROR__?: {
    getSnapshot(): {
      connected: boolean;
      mode: "auto" | "rhino" | "python";
      inUse: "rhino" | "python";
      objects: Array<{ id: string; name: string; layer: string; bounds: { min: number[]; max: number[] } }>;
      selection: string[];
      sync: { done: number; total: number } | null;
    };
    latencyP90(): number | null;
  };
  __HAI_TOOLS__?: {
    getSnapshot(): {
      activeId: string;
      layout: Array<string | null>;
      overlay: {
        notice: string | null;
        sectionMm: number | null;
        measure: unknown[];
        marked: string | null;
        draft: { type: string } | null;
      };
      question: string | null;
    };
    registry: {
      register(tool: { id: string; label: string; icon: string; shortcut: string }): void;
    };
  };
  __HAI_TRACKING__?: { frames: unknown[] };
  __HAI_VOICE__?: {
    context: {
      begin(now: number, hoveredId: string | null): void;
      hover(id: string | null, now: number): void;
      tick(now: number): void;
      end(now: number): void;
      clear(): void;
    };
  };
  __HAI_GESTURES__?: { events: E2EGesture[] };
  __HAI_SPEECH__?: {
    speaker: { getSnapshot(): { engine: string | null; firstAudio: number[] } };
    roundTrip(text: string): Promise<string | null>;
  };
}
