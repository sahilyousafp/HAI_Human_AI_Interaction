import type { ReplyVoice, SpeechMode } from "@hai/protocol";
import { useSyncExternalStore } from "react";
import { ListGroup, ListRow, Switch } from "../ui/controls.tsx";
import type { VoiceAvailability } from "./availability.ts";
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
  availability,
  onDownload,
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
  /** Whether the voice models are in place (in the desktop app they are downloaded after install). */
  availability: VoiceAvailability;
  /** Starts (or restarts) the download of the voice models. */
  onDownload: () => void;
}) {
  const stats = useSyncExternalStore(transcriber.subscribe, transcriber.getSnapshot);
  const latency = p90(stats.latencies);
  const spoken = useSyncExternalStore(speaker.subscribe, speaker.getSnapshot);
  const firstAudio = p90(spoken.firstAudio);
  return (
    <div className="settings-page-body voice-settings" data-testid="voice-settings">
      {availability.kind !== "ready" && (
        <ListGroup
          title="Voice models"
          footer="Speech to text and spoken replies run on this computer, from models that are downloaded once."
        >
          <ListRow
            label={
              availability.kind === "preparing"
                ? availability.percent === null
                  ? "Getting ready"
                  : "Downloading"
                : availability.label
            }
            control={
              availability.kind === "missing" ? (
                <button
                  type="button"
                  className="secondary"
                  data-testid="voice-models-download"
                  data-hand-press
                  onClick={onDownload}
                >
                  {availability.reason === "failed" ? "Try again" : "Download"}
                </button>
              ) : (
                <span className="list-value" data-testid="voice-models-progress">
                  {availability.percent === null ? "" : `${availability.percent}%`}
                </span>
              )
            }
          />
        </ListGroup>
      )}
      <ListGroup
        title="Speech to text"
        footer={
          <span data-testid="speech-mode-note">
            {mode === "device"
              ? "Audio never leaves this laptop: it is turned into text here and then dropped."
              : "Your browser sends what you say to its vendor's servers (Google for Chrome, Microsoft for Edge) to turn it into text."}
          </span>
        }
      >
        <ListRow
          label="Speech to text"
          htmlFor="speech-mode"
          control={
            <select
              id="speech-mode"
              className="list-select"
              data-testid="speech-mode"
              value={mode}
              onChange={(e) => onMode(e.target.value as SpeechMode)}
            >
              <option value="device">On this laptop</option>
              <option value="cloud" disabled={!cloudSpeechAvailable()}>
                Browser service (sends audio to a third party)
              </option>
            </select>
          }
        />
        {mode === "device" && (
          <>
            <ListRow
              label="Runs on"
              control={
                <span
                  data-testid="speech-backend"
                  className={stats.backend ? "list-value" : "list-value placeholder"}
                >
                  {stats.backend ?? "starts with your first request"}
                </span>
              }
            />
            <ListRow
              label="End of speech to text, p90"
              control={
                <span className="list-value" data-testid="speech-latency">
                  {latency === null ? "-" : `${latency} ms`}
                </span>
              }
            />
          </>
        )}
      </ListGroup>

      <ListGroup
        title="Listening"
        footer={
          'Hold ` or press the microphone to speak a request. With Listen for names on, only what starts with a team name ("Mochi, ...", "Architect, ...") becomes a request; everything else is dropped at once.'
        }
      >
        <ListRow
          label="Listen for names"
          detail="The microphone stays on"
          control={
            <Switch
              label="Listen for names"
              testId="listen-for-names"
              checked={listenForNames}
              onChange={onListenForNames}
            />
          }
        />
      </ListGroup>

      <ListGroup title="Mochi's replies" footer="Generated on this laptop; talking to Mochi interrupts it.">
        <ListRow
          label="Speak Mochi's replies"
          control={
            <Switch
              label="Speak Mochi's replies"
              testId="speak-replies"
              checked={speakReplies}
              onChange={onSpeakReplies}
            />
          }
        />
        {speakReplies && (
          <>
            <ListRow
              label="Voice"
              htmlFor="reply-voice"
              control={
                <select
                  id="reply-voice"
                  className="list-select"
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
              }
            />
            <ListRow
              label="Speaks with"
              control={
                <span
                  data-testid="reply-engine"
                  className={spoken.engine === null ? "list-value placeholder" : "list-value"}
                >
                  {spoken.engine === null && "starts with Mochi's first reply"}
                  {spoken.engine === "none" && "no voice on this computer"}
                  {spoken.engine !== null && spoken.engine !== "none" && spoken.engine}
                </span>
              }
            />
            <ListRow
              label="First sound, p90"
              control={
                <span className="list-value" data-testid="reply-latency">
                  {firstAudio === null ? "-" : `${firstAudio} ms`}
                </span>
              }
            />
          </>
        )}
      </ListGroup>
    </div>
  );
}
