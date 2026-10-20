import type { ReplyVoice, SpeechMode } from "@aex/protocol";
import { useSyncExternalStore } from "react";
import { cloudSpeechAvailable } from "./listeners.ts";
import type { Speaker } from "./speaker.ts";
import { KOKORO_VOICES } from "./speaker-messages.ts";
import { p90, type Transcriber } from "./transcriber.ts";

/**
 * Settings: where speech becomes text, whether the microphone listens for team names, and how Mochi's replies are
 * spoken. On this laptop is the default and keeps audio on the machine; the browser's speech service is opt-in and
 * says plainly that it sends audio to a third party. Shows the on-device backends and how long they take.
 */
export function VoiceSettingsCard({
  mode,
  onMode,
  listenForNames,
  onListenForNames,
  speakReplies,
  onSpeakReplies,
  replyVoice,
  onReplyVoice,
  speaker,
  transcriber,
}: {
  mode: SpeechMode;
  onMode: (mode: SpeechMode) => void;
  listenForNames: boolean;
  onListenForNames: (on: boolean) => void;
  speakReplies: boolean;
  onSpeakReplies: (on: boolean) => void;
  replyVoice: ReplyVoice;
  onReplyVoice: (voice: ReplyVoice) => void;
  speaker: Speaker;
  transcriber: Transcriber;
}) {
  const stats = useSyncExternalStore(transcriber.subscribe, transcriber.getSnapshot);
  const latency = p90(stats.latencies);
  const spoken = useSyncExternalStore(speaker.subscribe, speaker.getSnapshot);
  const firstAudio = p90(spoken.firstAudio);
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
      <label className="voice-names">
        <input
          type="checkbox"
          data-testid="listen-for-names"
          checked={listenForNames}
          onChange={(e) => onListenForNames(e.target.checked)}
        />
        <span>
          Listen for names
          <span className="muted">
            {" "}
            The microphone stays on. Only what starts with a team name ("Mochi, ...", "Architect, ...")
            becomes a request; everything else is dropped at once.
          </span>
        </span>
      </label>
      {mode === "device" && (
        <dl className="voice-stats">
          <dt>Runs on</dt>
          <dd data-testid="speech-backend" className={stats.backend ? "" : "placeholder"}>
            {stats.backend ?? "starts with your first request"}
          </dd>
          <dt>End of speech to text, p90</dt>
          <dd data-testid="speech-latency">{latency === null ? "-" : `${latency} ms`}</dd>
        </dl>
      )}
      <label className="voice-names">
        <input
          type="checkbox"
          data-testid="speak-replies"
          checked={speakReplies}
          onChange={(e) => onSpeakReplies(e.target.checked)}
        />
        <span>
          Speak Mochi's replies
          <span className="muted"> Generated on this laptop; talking to Mochi interrupts it.</span>
        </span>
      </label>
      {speakReplies && (
        <>
          <label className="voice-mode">
            <span>Mochi's voice</span>
            <select
              data-testid="reply-voice"
              value={replyVoice}
              onChange={(e) => onReplyVoice(e.target.value as ReplyVoice)}
            >
              {Object.entries(KOKORO_VOICES).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <dl className="voice-stats">
            <dt>Speaks with</dt>
            <dd data-testid="reply-engine" className={spoken.engine === null ? "placeholder" : ""}>
              {spoken.engine === null && "starts with Mochi's first reply"}
              {spoken.engine === "none" && "no voice on this computer"}
              {spoken.engine !== null && spoken.engine !== "none" && spoken.engine}
            </dd>
            <dt>First sound, p90</dt>
            <dd data-testid="reply-latency">{firstAudio === null ? "-" : `${firstAudio} ms`}</dd>
          </dl>
        </>
      )}
    </section>
  );
}
