/** Frames a GPU delegate may process without ever finding a hand before it is taken to be broken. */
export const GPU_EMPTY_FRAME_LIMIT = 300;

/**
 * Some GPU drivers start a MediaPipe graph and then return no landmarks at all, so the CPU fallback in
 * `withDelegate` (which only sees creation failures) never runs. After a few hundred empty frames with no hand
 * ever seen, stop trusting the GPU. A hand found even once means the delegate works: people move in and out of
 * frame, and empty frames are normal.
 */
export function shouldFallBackToCpu(state: {
  backend: "GPU" | "CPU";
  fellBack: boolean;
  everFoundHand: boolean;
  emptyFrames: number;
}): boolean {
  return (
    state.backend === "GPU" &&
    !state.fellBack &&
    !state.everFoundHand &&
    state.emptyFrames >= GPU_EMPTY_FRAME_LIMIT
  );
}
