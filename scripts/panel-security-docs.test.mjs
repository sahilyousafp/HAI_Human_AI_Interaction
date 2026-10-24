import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FRAME_CSP, FRAME_SANDBOX } from "../apps/web/src/panel/frame-document.ts";

// SECURITY.md promises what a generated panel cannot do. Each promise must be one a test tries to break: this keeps
// the document and the hostile-panel test (e2e/panel-sandbox.spec.ts) in step.

const root = join(import.meta.dirname, "..");
const security = readFileSync(join(root, "SECURITY.md"), "utf8");
const agentDoc = readFileSync(join(root, "docs", "agent.md"), "utf8");
const hostile = readFileSync(join(root, "e2e", "panel-sandbox.spec.ts"), "utf8");
const section = security.slice(security.indexOf("## Generated panels"), security.indexOf("## Reporting"));

describe("SECURITY.md on generated panels", () => {
  it("states the sandbox flags and the policy the frame really uses", () => {
    expect(section).toContain(`sandbox="${FRAME_SANDBOX}"`);
    expect(section).toContain(FRAME_CSP);
  });

  // The promise in the document, and the attempt in the hostile panel that tries to break it.
  it.each([
    ["session token", "token"],
    ["storage or cookies", "cookie"],
    ["fetch", "fetchOutside"],
    ["the bridge", "fetchBridge"],
    ["open a socket", "websocket"],
    ["event stream", "eventsource"],
    ["send a beacon", "beacon"],
    ["load an image", "image"],
    ["script or frame from outside itself", "importScript"],
    ["post a form", "form"],
    ["open a window", "windowOpen"],
    ["navigate the app", "topNavigation"],
    ["send itself elsewhere", "selfNavigation"],
    ["invalid operation changes nothing", "malformedOperations"],
  ])("promises that a panel cannot %s, and a hostile panel tries to", (promise, attempt) => {
    expect(`${section}\n${agentDoc}`.toLowerCase()).toContain(promise.toLowerCase());
    expect(hostile).toContain(`attempt("${attempt}"`);
  });

  it("names the limits that are tested elsewhere", () => {
    expect(section).toContain("60 messages per second");
    expect(section).toContain("256 KB");
    expect(hostile).toContain("Flooding is limited");
  });

  it("never uses an em dash", () => {
    expect(security).not.toContain("—");
  });
});
