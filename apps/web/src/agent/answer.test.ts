import { describe, expect, it } from "vitest";
import { type AnswerTargets, answerYesNo } from "./answer.ts";

/** The things that may wait for a yes or no, each recording what it was asked. */
function setup(waiting: { sent?: boolean; transcript?: boolean; approvals?: number; offers?: number }) {
  const log: string[] = [];
  const targets: AnswerTargets = {
    voice: {
      reviewing: waiting.transcript ?? false,
      confirm: () => log.push("transcript sent"),
      discard: () => log.push("transcript discarded"),
      stopSent: () => {
        if (waiting.sent) log.push("held request stopped");
        return waiting.sent ?? false;
      },
    },
    approvals: {
      waiting: waiting.approvals ?? 0,
      answer: (yes) => {
        const answered = (waiting.approvals ?? 0) === 1;
        if (answered) log.push(yes ? "approval allowed" : "approval denied");
        return answered;
      },
    },
    offers: {
      answer: (yes) => {
        const answered = (waiting.offers ?? 0) === 1;
        if (answered) log.push(yes ? "panel opened" : "panel skipped");
        return answered;
      },
    },
  };
  return { targets, log };
}

describe("answerYesNo", () => {
  it("a shake right after a held request was sent stops it before anything else, and a nod leaves it", () => {
    const shake = setup({ sent: true, approvals: 1, offers: 1 });
    expect(answerYesNo(false, shake.targets)).toBe(true);
    expect(shake.log).toEqual(["held request stopped"]);
    const nod = setup({ sent: true, approvals: 1 });
    expect(answerYesNo(true, nod.targets)).toBe(true);
    expect(nod.log).toEqual(["approval allowed"]);
  });

  it("a nod opens the panel when only the offer waits, and a shake skips it", () => {
    const nod = setup({ offers: 1 });
    expect(answerYesNo(true, nod.targets)).toBe(true);
    expect(nod.log).toEqual(["panel opened"]);
    const shake = setup({ offers: 1 });
    expect(answerYesNo(false, shake.targets)).toBe(true);
    expect(shake.log).toEqual(["panel skipped"]);
  });

  it("an approval card is answered before the offer, which keeps waiting", () => {
    const t = setup({ approvals: 1, offers: 1 });
    expect(answerYesNo(true, t.targets)).toBe(true);
    expect(t.log).toEqual(["approval allowed"]);
  });

  it("a transcript under review is answered before the approval and the offer", () => {
    const t = setup({ transcript: true, approvals: 1, offers: 1 });
    expect(answerYesNo(true, t.targets)).toBe(true);
    expect(t.log).toEqual(["transcript sent"]);
    const no = setup({ transcript: true, approvals: 1, offers: 1 });
    expect(answerYesNo(false, no.targets)).toBe(true);
    expect(no.log).toEqual(["transcript discarded"]);
  });

  it("several approval cards waiting leave the offer alone: nothing here answers", () => {
    const t = setup({ approvals: 2, offers: 1 });
    expect(answerYesNo(true, t.targets)).toBe(false);
    expect(t.log).toEqual([]);
  });

  it("with nothing waiting it answers nothing, so the tool's own question gets the gesture", () => {
    const t = setup({});
    expect(answerYesNo(true, t.targets)).toBe(false);
    expect(answerYesNo(false, t.targets)).toBe(false);
  });

  it("two offers waiting are not answered by a gesture", () => {
    const t = setup({ offers: 2 });
    expect(answerYesNo(true, t.targets)).toBe(false);
  });
});
