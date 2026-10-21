// Dev-build hooks the app exposes for end-to-end tests (declared in the app; repeated here for the e2e typecheck).
type E2EPoint = [number, number];
type E2EGesture = { type: string; ts: number; confidence: number; [key: string]: unknown };

interface Window {
  __AEX_VIEWER__?: {
    camera(): { target: [number, number, number]; azimuth: number; elevation: number; distance: number };
    meshCount(): number;
    pick(x: number, y: number): string | null;
    latencyP90(): number | null;
    renders(): number;
    project(point: [number, number, number]): [number, number];
    overSection(x: number, y: number): boolean;
    sectionOutline(): Array<[number, number]>;
    sun(): { altitude: number; azimuth: number; label: string } | null;
    handAt(x: number, y: number): [number, number];
  };
  __AEX_INPUT__?: {
    // biome-ignore lint/suspicious/noExplicitAny: tests build events loosely; the app validates their shape.
    gestures(events: any[]): void;
    /** The right hand's pinch point, and the left hand's. */
    pointer(right: E2EPoint | null, left?: E2EPoint | null): void;
    engaged(engaged: boolean): void;
  };
  __AEX_SCENE__?: {
    apply(label: string, ops: unknown[]): boolean;
    select(ids: string[]): void;
    getSnapshot(): { doc: { elements: Record<string, Record<string, unknown>> } | null; selection: string[] };
  };
  __AEX_TOOLS__?: {
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
  __AEX_TRACKING__?: { frames: unknown[] };
  __AEX_VOICE__?: {
    context: {
      begin(now: number, hoveredId: string | null): void;
      hover(id: string | null, now: number): void;
      end(now: number): void;
      clear(): void;
    };
  };
  __AEX_GESTURES__?: { events: E2EGesture[] };
  __AEX_SPEECH__?: {
    speaker: { getSnapshot(): { engine: string | null; firstAudio: number[] } };
    roundTrip(text: string): Promise<string | null>;
  };
}
