import { useEffect, useSyncExternalStore } from "react";
import { ToolIcon } from "../tools/ToolOverlays.tsx";
import { VOICE } from "./voice-config.ts";
import type { VoiceInput } from "./voice-input.ts";

const MIC_ICON = "M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3";
const STOP_ICON = "M7 7h10v10H7z";
/** A discarded transcript stays readable this long before the bar clears. */
const DISCARDED_MS = 2500;

/** The microphone button: the main way to ask the agent. Press to talk (or hold the talk key); press again to stop. */
export function MicButton({
  voice,
  onStart,
  disabled = false,
  notice = null,
}: {
  voice: VoiceInput;
  onStart: () => void;
  /** No agent to send to (not installed or not signed in). */
  disabled?: boolean;
  /** Why the microphone cannot be used yet (the voice models are downloading), or null. */
  notice?: string | null;
}) {
  const state = useSyncExternalStore(voice.subscribe, voice.getSnapshot);
  const live = state.phase === "starting" || state.phase === "listening";
  return (
    <button
      type="button"
      className="mic-button"
      data-testid="mic-button"
      data-state={state.phase}
      data-hand-press
      aria-pressed={live}
      data-voice={notice ? "preparing" : "ready"}
      disabled={(disabled || notice !== null) && !live}
      aria-label={live ? "Stop listening" : (notice ?? "Speak to the agent")}
      title={live ? "Stop listening" : (notice ?? "Speak to the agent (or hold the ` key)")}
      onClick={() => (live ? voice.finish() : onStart())}
    >
      <ToolIcon path={live ? STOP_ICON : MIC_ICON} size={20} />
    </button>
  );
}

/**
 * What the voice request is doing, above the input: listening (with a level meter), transcribing, then the
 * transcript with its send countdown, the elements it refers to, and how to send or discard it.
 */
export function VoiceBar({ voice, nameOf }: { voice: VoiceInput; nameOf: (id: string) => string }) {
  const state = useSyncExternalStore(voice.subscribe, voice.getSnapshot);
  const references = useSyncExternalStore(voice.context.subscribe, () => voice.context.ids);

  // Enter sends and Escape discards a waiting transcript, before anything else (the text box, the tools) sees them.
  useEffect(() => {
    if (state.phase !== "review") return;
    const key = (e: KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        voice.confirm();
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        voice.discard();
      }
    };
    window.addEventListener("keydown", key, { capture: true });
    return () => window.removeEventListener("keydown", key, { capture: true });
  }, [state.phase, voice]);

  useEffect(() => {
    if (state.phase !== "discarded" && state.phase !== "sent") return;
    const id = setTimeout(() => voice.dismiss(), state.phase === "sent" ? 0 : DISCARDED_MS);
    return () => clearTimeout(id);
  }, [state.phase, voice]);

  // Listening for names shows only in the header: speech without a name is never shown anywhere.
  if (state.phase === "off" || state.phase === "sent" || state.phase === "names") return null;
  const refs = references.length > 0 && (
    <ol className="voice-refs" data-testid="voice-refs" aria-label="What this refers to">
      {references.map((id, i) => (
        <li key={id}>
          <span className="voice-ref-n">{i + 1}</span>
          {nameOf(id)}
        </li>
      ))}
    </ol>
  );
  return (
    <div className="voice-bar" data-testid="voice-bar" data-phase={state.phase} aria-live="polite">
      {state.phase === "starting" && <p className="voice-status">Starting the microphone...</p>}
      {state.phase === "listening" && (
        <>
          <p className="voice-status">
            <span className="voice-level" aria-hidden="true">
              <span
                className="voice-level-fill"
                style={{ transform: `scaleX(${Math.max(0.06, state.level)})` }}
              />
            </span>
            {state.speaking ? "Listening. Point at what you mean." : "Speak now. Point at what you mean."}
          </p>
          {refs}
        </>
      )}
      {state.phase === "transcribing" && (
        <>
          <p className="voice-status">Writing it down...</p>
          {refs}
        </>
      )}
      {state.phase === "review" && (
        <>
          <textarea
            className="voice-transcript"
            data-testid="voice-transcript"
            rows={2}
            value={state.text}
            aria-label="Transcript (click to correct it)"
            onChange={(e) => voice.edit(e.target.value)}
          />
          {!state.paused && (
            <span
              className="voice-countdown"
              data-testid="voice-countdown"
              style={{ animationDuration: `${VOICE.sendDelayMs}ms` }}
              aria-hidden="true"
            />
          )}
          {refs}
          <div className="voice-actions">
            <button type="button" className="primary" data-hand-press onClick={() => voice.confirm()}>
              Send <kbd>Enter</kbd>
            </button>
            <button type="button" className="secondary" data-hand-press onClick={() => voice.discard()}>
              Discard <kbd>Esc</kbd>
            </button>
            <span className="muted">
              {state.paused ? "Edited: send when ready" : "Nod to send, shake to discard"}
            </span>
          </div>
        </>
      )}
      {state.phase === "discarded" && (
        <p className="voice-status voice-discarded" data-testid="voice-discarded">
          Discarded: <s>{state.text}</s>
        </p>
      )}
      {state.phase === "error" && (
        <div className="voice-error" role="alert" data-testid="voice-error" data-error={state.error}>
          <span>{state.message}</span>
          <button type="button" className="secondary" onClick={() => voice.dismiss()}>
            OK
          </button>
        </div>
      )}
    </div>
  );
}
