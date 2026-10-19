import { describe, expect, it } from "vitest";
import * as mod from "./index.ts";

describe("@aex/agent-core", () => {
  it("loads its entry point", () => {
    expect(mod).toBeTypeOf("object");
  });
});
