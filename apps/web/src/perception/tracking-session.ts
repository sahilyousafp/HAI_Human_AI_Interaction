import { DEFAULT_GESTURES, pinchPoint, pinchRatio } from "@hai/perception";
import type { GestureEvent, Hand, Point2, TrackedHand, TrackingFrame } from "@hai/protocol";
import type { InputBus } from "../input/input-bus.ts";
import type { CameraEffectsState } from "./camera-effects.ts";
import { type CameraPrefs, loadCameraPrefs, saveCameraPrefs } from "./camera-prefs.ts";
import { DetectionStore } from "./detection-store.ts";
import { GestureStore } from "./gesture-store.ts";
import { downloadFrames, LandmarkRecorder } from "./recorder.ts";
import { type CameraInfo, Tracker, type TrackerState, type TrackerStats } from "./tracker.ts";

interface Summary {
  seq: number;
  hands: string[];
  face: boolean;
  faceRan: boolean;
  yaw: number | null;
  pitch: number | null;
  captureTs: number;
  inferenceDoneTs: number;
}

declare global {
  interface Window {
    /** Dev builds only: recent frame summaries for end-to-end tests. Never contains pixels. */
    __HAI_TRACKING__?: { frames: Summary[]; faceCadence: 1 | 2 };
    /** Dev builds only: recent gesture events for end-to-end tests. */
    __HAI_GESTURES__?: { events: GestureEvent[] };
  }
}

/** What the camera views and settings render: changes at most a few times a second, never per frame. */
export interface SessionSnapshot {
  state: TrackerState;
  effects: CameraEffectsState | null;
  cameraInfo: CameraInfo | null;
  prefs: CameraPrefs;
  /** Draw the tracked points over the camera image. */
  debugView: boolean;
  /** Also draw the unsmoothed points (debug view only). */
  showRaw: boolean;
  recording: boolean;
}

/**
 * The camera and everything that tracks it, for the whole page: the tracker (camera stream and perception
 * worker), the gesture and detection stores, the latest frame, and the camera settings. It lives as long as the
 * app, so opening or closing the settings or moving the camera view never stops the camera. Its own `video`
 * element is attached wherever the camera is shown.
 */
export class TrackingSession {
  readonly video: HTMLVideoElement;
  /**
   * Where the video waits while no camera view shows it. A video taken off the page stops delivering frames, so it is
   * parked on the page, out of sight, and tracking carries on.
   */
  private parking: HTMLDivElement | null = null;
  readonly gestures = new GestureStore();
  readonly detection = new DetectionStore();
  readonly recorder = new LandmarkRecorder();
  /** The newest tracked frame (smoothed landmarks only, never pixels), for drawing every animation frame. */
  latestFrame: TrackingFrame | null = null;
  latestRaw: TrackedHand[] = [];
  latestStats: TrackerStats | null = null;
  private latestFaceRan = false;
  private readonly tracker: Tracker;
  private snapshot: SessionSnapshot;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly bus: InputBus,
    options: { perfDelayMs?: number } = {},
  ) {
    this.video = document.createElement("video");
    this.video.className = "preview-video";
    this.video.muted = true;
    this.video.playsInline = true;
    this.snapshot = {
      state: { camera: "off" },
      effects: null,
      cameraInfo: null,
      prefs: loadCameraPrefs(),
      debugView: true,
      showRaw: false,
      recording: false,
    };
    this.tracker = new Tracker(
      this.video,
      {
        onState: (state) => this.update({ state }),
        onEffects: (effects) => this.update({ effects }),
        onCamera: (cameraInfo) => this.update({ cameraInfo }),
        onGestures: (events, gestureState, gestureMs) => this.onGestures(events, gestureState, gestureMs),
        onFrame: (frame, stats, faceRan, rawHands) => this.onFrame(frame, stats, faceRan, rawHands),
      },
      options,
    );
    this.tracker.setMirrored(this.snapshot.prefs.mirrored);
    void this.tracker.setDevice(this.snapshot.prefs.deviceId);
  }

  /**
   * Puts the session on the page, once it is mounted (not in the constructor, which React may run twice): the video's
   * out-of-sight spot, and in dev builds the landmark recorder for tests. Returns how to take it off again.
   */
  connect(): () => void {
    const parking = document.createElement("div");
    parking.className = "camera-parking";
    parking.setAttribute("aria-hidden", "true");
    document.body.append(parking);
    this.parking = parking;
    if (!this.video.isConnected) this.park();
    if (import.meta.env.DEV) window.__HAI_RECORDER__ = this.recorder;
    return () => {
      this.stop();
      parking.remove();
      this.parking = null;
    };
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): SessionSnapshot => this.snapshot;

  /** Puts the video back in its out-of-sight spot (the camera view is hidden or gone); it keeps playing. */
  park(): void {
    this.parking?.append(this.video);
    void this.video.play().catch(() => {});
  }

  get running(): boolean {
    const { camera } = this.snapshot.state;
    return camera === "on" || camera === "starting";
  }

  /** Starts the camera, or stops it and clears everything it measured. */
  toggle(): void {
    if (this.running) this.stop();
    else void this.tracker.start();
  }

  stop(): void {
    this.tracker.stop();
    this.latestFrame = null;
    this.latestStats = null;
    this.latestRaw = [];
    this.gestures.reset();
    this.detection.reset();
    this.update({ effects: null, cameraInfo: null });
  }

  setPrefs(prefs: CameraPrefs): void {
    saveCameraPrefs(prefs);
    this.tracker.setMirrored(prefs.mirrored);
    void this.tracker.setDevice(prefs.deviceId);
    this.update({ prefs });
  }

  setDebugView(debugView: boolean): void {
    this.update({ debugView, ...(debugView ? {} : { showRaw: false }) });
    if (!debugView) this.tracker.setRawHands(false);
  }

  setShowRaw(showRaw: boolean): void {
    this.tracker.setRawHands(showRaw);
    this.update({ showRaw });
  }

  /** Dev builds: record landmark frames to a file, for new test fixtures. */
  toggleRecording(): void {
    if (this.recorder.active) {
      downloadFrames(this.recorder.stop());
      this.update({ recording: false });
    } else {
      this.recorder.start();
      this.update({ recording: true });
    }
  }

  private onGestures(
    events: GestureEvent[],
    gestureState: Parameters<GestureStore["push"]>[1],
    gestureMs: number,
  ): void {
    this.gestures.push(events, gestureState, gestureMs);
    // The frame these gestures came from was delivered just before, in onFrame.
    if (this.latestFrame) this.detection.push(this.latestFrame, this.latestFaceRan, gestureState, events);
    this.bus.setEngaged(gestureState.engaged);
    this.bus.setStopArmed(gestureState.stopArmed);
    this.bus.emitGestures(events);
    if (import.meta.env.DEV && events.length > 0) {
      if (!window.__HAI_GESTURES__) window.__HAI_GESTURES__ = { events: [] };
      const log = window.__HAI_GESTURES__.events;
      log.push(...events);
      if (log.length > 500) log.splice(0, log.length - 500);
    }
  }

  private onFrame(
    frame: TrackingFrame,
    stats: TrackerStats,
    faceRan: boolean,
    rawHands?: TrackedHand[],
  ): void {
    this.latestFrame = frame;
    this.latestFaceRan = faceRan;
    this.latestRaw = rawHands ?? [];
    this.latestStats = stats;
    // Every visible hand is a pointer, at its pinch point.
    const hands: Partial<Record<Hand, Point2>> = {};
    const closing: Partial<Record<Hand, boolean>> = {};
    for (const h of frame.hands) {
      hands[h.handedness] = pinchPoint(h);
      closing[h.handedness] = pinchRatio(h, frame.aspect) < DEFAULT_GESTURES.pinch.release;
    }
    this.bus.emitPointer({
      hands,
      closing,
      ...(frame.aspect ? { aspect: frame.aspect } : {}),
      ts: frame.captureTs,
    });
    if (!import.meta.env.DEV) return;
    this.recorder.push(frame);
    if (!window.__HAI_TRACKING__) window.__HAI_TRACKING__ = { frames: [], faceCadence: 1 };
    const store = window.__HAI_TRACKING__;
    store.faceCadence = stats.faceCadence;
    store.frames.push({
      seq: frame.seq,
      hands: frame.hands.map((h) => h.handedness),
      face: Boolean(frame.face),
      faceRan,
      yaw: frame.face?.headPose.yaw ?? null,
      pitch: frame.face?.headPose.pitch ?? null,
      captureTs: frame.captureTs,
      inferenceDoneTs: frame.inferenceDoneTs,
    });
    if (store.frames.length > 600) store.frames.splice(0, store.frames.length - 600);
  }

  private update(partial: Partial<SessionSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...partial };
    for (const listener of this.listeners) listener();
  }
}
