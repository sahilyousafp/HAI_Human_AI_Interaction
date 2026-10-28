import { MicButton, VoiceBar } from "./VoiceBar.tsx";
import type { VoiceInput } from "./voice-input.ts";

/**
 * The microphone and what it heard, over the model, for when Claude chat is off: the chat panel (which holds both
 * otherwise) is gone, but spoken commands still need a button, a level and the words that were understood.
 */
export function CommandBar({
  voice,
  startVoice,
  notice,
  nameOf,
}: {
  voice: VoiceInput;
  startVoice: () => void;
  /** Why the microphone cannot be used yet (the voice models are downloading), or null. */
  notice: string | null;
  nameOf: (id: string) => string;
}) {
  return (
    <section className="command-bar" data-testid="command-bar" aria-label="Spoken commands">
      <MicButton voice={voice} onStart={startVoice} notice={notice} purpose="a command" />
      <VoiceBar voice={voice} nameOf={nameOf} />
    </section>
  );
}
