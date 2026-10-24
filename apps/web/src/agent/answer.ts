/**
 * What a nod ("yes") or a shake ("no") answers, when several things may be waiting for one. The order is fixed, so
 * the same gesture always means the same thing:
 *
 * 1. a voice request under review (a nod sends it, a shake throws it away);
 * 2. an approval card, when exactly one waits;
 * 3. a panel offer, when exactly one waits and no approval card is (a nod opens the panel, a shake skips it);
 * 4. otherwise nothing here: the active tool's own question gets it.
 *
 * It returns whether it answered, and a shake that answered something never cancels the active tool.
 */
export interface AnswerTargets {
  /** The voice request under review, if there is one. */
  voice: { readonly reviewing: boolean; confirm(): void; discard(): void };
  approvals: {
    /** How many approval cards wait. */
    readonly waiting: number;
    /** Answers the only waiting card; false if there is not exactly one (or a nod arrives while not engaged). */
    answer(yes: boolean): boolean;
  };
  offers: {
    /** Answers the only waiting offer; false if there is not exactly one (or a nod arrives while not engaged). */
    answer(yes: boolean): boolean;
  };
}

export function answerYesNo(yes: boolean, { voice, approvals, offers }: AnswerTargets): boolean {
  if (voice.reviewing) {
    if (yes) voice.confirm();
    else voice.discard();
    return true;
  }
  if (approvals.waiting > 0) return approvals.answer(yes);
  return offers.answer(yes);
}
