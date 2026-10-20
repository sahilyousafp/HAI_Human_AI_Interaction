import { describe, expect, it } from "vitest";
import type { AgentProvider, Detection } from "./index.ts";

describe("@aex/agent-core", () => {
  it("describes a provider: detection either succeeds with a version or explains what to do", () => {
    const missing: Detection = {
      ok: false,
      reason: "missing",
      message: "Not installed.",
      fix: "Install it.",
    };
    const provider: AgentProvider = {
      id: "test",
      label: "Test",
      detect: async () => missing,
      start: async () => {
        throw new Error("not used");
      },
    };
    return expect(provider.detect()).resolves.toMatchObject({ ok: false, reason: "missing" });
  });
});
