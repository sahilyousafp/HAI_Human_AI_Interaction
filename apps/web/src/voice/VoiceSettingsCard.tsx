import type { SpeechMode } from "@aex/protocol";
import { useSyncExternalStore } from "react";
import { cloudSpeechAvailable } from "./listeners.ts";
import { p90, type Transcriber } from "./transcriber.ts";

/**
 * Settings: where speech becomes text. On this laptop is the default and keeps audio on the machine; the browser's
 * speech service is opt-in and says plainly that it sends audio to a third party. Shows the on-device backend and
 * how long transcripts take.
 */
export function VoiceSettingsCard({
  mode,
  onMode,
  transcriber,
}: {
  mode: SpeechMode;
  onMode: (mode: SpeechMode) => void;
  transcriber: Transcriber;
}) {
  const stats = useSyncExternalStore(transcriber.subscribe, transcriber.getSnapshot);
  const latency = p90(stats.latencies);
  return (
    <section className="palette-settings voice-settings" data-testid="voice-settings" aria-label="Voice">
      <header className="detection-head">
        <h2>Voice</h2>
        <span className="muted">hold ` or press the microphone</span>
      </header>
      <label className="voice-mode">
        <span>Speech to text</span>
        <select data-testid="speech-mode" value={mode} onChange={(e) => onMode(e.target.value as SpeechMode)}>
          <option value="device">On this laptop</option>
          <option value="cloud" disabled={!cloudSpeechAvailable()}>
            Browser speech service (sends audio to a third party)
          </option>
        </select>
      </label>
      <p className="muted" data-testid="speech-mode-note">
        {mode === "device"
          ? "Audio never leaves this laptop: it is turned into text here and then dropped."
          : "Your browser sends what you say to its vendor's servers (Google for Chrome, Microsoft for Edge) to turn it into text."}
      </p>
      {mode === "device" && (
        <dl className="voice-stats">
          <dt>Runs on</dt>
          <dd data-testid="speech-backend">{stats.backend ?? "starts with your first request"}</dd>
          <dt>End of speech to text, p90</dt>
          <dd data-testid="speech-latency">{latency === null ? "-" : `${latency} ms`}</dd>
        </dl>
      )}
    </section>
  );
}
