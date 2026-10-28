import { type FormEvent, useState } from "react";
import { MicButton, VoiceBar } from "./VoiceBar.tsx";
import type { VoiceInput } from "./voice-input.ts";

/**
 * Commands over the model, for when Claude chat is off: the chat panel (which holds the microphone and the text box
 * otherwise) is gone, but commands still need a way in. Say them with the microphone, or type them here: a typed command
 * is taken as though it had been spoken, so it acts on what is selected or pointed at, and what is not a command says so.
 */
export function CommandBar({
  voice,
  startVoice,
  voiceOn,
  notice,
  nameOf,
}: {
  voice: VoiceInput;
  startVoice: () => void;
  /** The voice feature is on: the microphone is offered. Without it commands are typed. */
  voiceOn: boolean;
  /** Why the microphone cannot be used yet (the voice models are downloading), or null. */
  notice: string | null;
  nameOf: (id: string) => string;
}) {
  const [draft, setDraft] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    voice.hear(text);
  };
  return (
    <section className="command-bar" data-testid="command-bar" aria-label="Commands">
      {voiceOn && <MicButton voice={voice} onStart={startVoice} notice={notice} purpose="a command" />}
      <form className="command-form" onSubmit={submit}>
        <input
          type="text"
          className="command-input"
          data-testid="command-input"
          aria-label="Type a command"
          placeholder={voiceOn ? "Say or type a command" : "Type a command, e.g. move 3 m east"}
          autoComplete="off"
          spellCheck={false}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
      </form>
      <VoiceBar voice={voice} nameOf={nameOf} />
    </section>
  );
}
