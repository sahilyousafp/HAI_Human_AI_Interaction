// Dev-build hooks the app exposes for end-to-end tests (declared in the app; repeated here for the e2e typecheck).
type E2EPoint = [number, number];
type E2EGesture = { type: string; ts: number; confidence: number; [key: string]: unknown };

interface Window {
  __AEX_VIEWER__?: {
    camera(): { target: [number, number, number]; azimuth: number; elevation: number; distance: number };
    meshCount(): number;
    pick(x: number, y: number): string | null;
    latencyP90(): number | null;
  };
  __AEX_INPUT__?: {
    // biome-ignore lint/suspicious/noExplicitAny: tests build events loosely; the app validates their shape.
    gestures(events: any[]): void;
    pointer(position: E2EPoint | null): void;
    engaged(engaged: boolean): void;
  };
  __AEX_SCENE__?: {
    apply(label: string, ops: unknown[]): boolean;
    select(ids: string[]): void;
  };
  __AEX_TRACKING__?: { frames: unknown[] };
  __AEX_GESTURES__?: { events: E2EGesture[] };
}
