import { describe, expect, it } from "vitest";
import { parseMessage } from "./messages.ts";
import { PANEL_MAX_BYTES, PanelDocument, PanelEvent } from "./panel.ts";

const frame = (type: string, payload: unknown) => JSON.stringify({ type, id: "m1", payload });
const doc = { title: "Clearance", width: 320, height: 240, html: "<p>hi</p>" };
const moveColumn = { op: "update", id: "c-1", patch: { position: [1000, 2000] } };

describe("panel messages", () => {
  it.each([
    ["panel.offer", { offerId: "o1", purpose: "Set the wall to column clearance", state: "waiting" }],
    ["panel.offer", { offerId: "o1", purpose: "Tolerance", state: "expired", agent: "architect" }],
    ["panel.open", { panelId: "p1", offerId: "o1", ...doc }],
    ["panel.update", { panelId: "p1", ...doc }],
    ["panel.close", { panelId: "p1", reason: "agent" }],
    ["panel.offer.answer", { offerId: "o1", answer: "accepted" }],
    ["panel.status", { panelId: "p1", state: "failed", reason: "The document threw on load" }],
    ["panel.closed", { panelId: "p1", outcome: "kept" }],
  ])("accepts %s", (type, payload) => {
    expect(parseMessage(frame(type, payload)).ok).toBe(true);
  });

  it.each([
    ["an offer without a purpose", "panel.offer", { offerId: "o1", purpose: " ", state: "waiting" }],
    ["an offer in an unknown state", "panel.offer", { offerId: "o1", purpose: "x", state: "maybe" }],
    [
      "an answer that is neither accepted nor skipped",
      "panel.offer.answer",
      { offerId: "o1", answer: "later" },
    ],
    ["a panel without a title", "panel.open", { panelId: "p1", offerId: "o1", ...doc, title: "" }],
    ["a panel without an offer", "panel.open", { panelId: "p1", ...doc }],
    ["a panel closing for an unknown reason", "panel.close", { panelId: "p1", reason: "boredom" }],
    ["a closed outcome that is unknown", "panel.closed", { panelId: "p1", outcome: "half" }],
    ["an unknown field", "panel.closed", { panelId: "p1", outcome: "kept", extra: 1 }],
  ])("rejects %s", (_name, type, payload) => {
    expect(parseMessage(frame(type, payload)).ok).toBe(false);
  });
});

describe("PanelDocument", () => {
  it("accepts a document of exactly 256 KB and refuses one byte more", () => {
    const filler = (bytes: number) => "a".repeat(bytes);
    expect(PanelDocument.safeParse({ ...doc, html: filler(PANEL_MAX_BYTES) }).success).toBe(true);
    const over = PanelDocument.safeParse({ ...doc, html: filler(PANEL_MAX_BYTES + 1) });
    expect(over.success).toBe(false);
    expect(over.error?.issues[0]?.message).toContain("256 KB");
  });

  it("counts bytes, not characters", () => {
    // 100 000 three-byte characters are 300 KB but only 100 000 characters.
    const html = "€".repeat(100_000);
    expect(html.length).toBeLessThan(PANEL_MAX_BYTES);
    expect(PanelDocument.safeParse({ ...doc, html }).success).toBe(false);
  });

  it.each([
    ["too narrow", { width: 100 }],
    ["too tall", { height: 5000 }],
    ["a fractional size", { width: 320.5 }],
    ["an empty document", { html: "" }],
  ])("rejects %s", (_name, change) => {
    expect(PanelDocument.safeParse({ ...doc, ...change }).success).toBe(false);
  });
});

describe("PanelEvent", () => {
  it.each([
    { type: "ready" },
    { type: "error", message: "x is not defined" },
    { type: "preview", ops: [moveColumn] },
    { type: "preview", ops: [] },
    { type: "commit" },
    { type: "get", requestId: "r1", query: { type: "column" } },
    { type: "get", requestId: "r2", query: { ids: ["c-1"], level: "L0" } },
    { type: "pressed", hit: true },
    { type: "key", key: "Escape" },
  ])("accepts $type", (event) => {
    expect(PanelEvent.safeParse(event).success).toBe(true);
  });

  it.each([
    ["an unknown event", { type: "navigate", url: "https://example.com" }],
    ["an operation that is not a scene operation", { type: "preview", ops: [{ op: "format-disk" }] }],
    ["an update without an id", { type: "preview", ops: [{ op: "update", patch: {} }] }],
    ["a preview that is not a list", { type: "preview", ops: moveColumn }],
    ["more than 500 operations", { type: "preview", ops: Array.from({ length: 501 }, () => moveColumn) }],
    ["a get for an unknown type", { type: "get", requestId: "r1", query: { type: "toaster" } }],
    ["a get with an unknown filter", { type: "get", requestId: "r1", query: { everything: true } }],
    ["a key other than Escape", { type: "key", key: "Enter" }],
    ["an extra field", { type: "commit", force: true }],
  ])("rejects %s", (_name, event) => {
    expect(PanelEvent.safeParse(event).success).toBe(false);
  });
});
