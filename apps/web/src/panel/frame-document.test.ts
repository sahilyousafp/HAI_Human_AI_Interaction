import { describe, expect, it } from "vitest";
import { FRAME_CSP, FRAME_SANDBOX, frameDocument } from "./frame-document.ts";
import { FRAME_RUNTIME } from "./frame-runtime.ts";

const theme = {
  scheme: "dark" as const,
  vars: { "--panel": "#1c1c1e", "--ink": "#f5f5f7", "--accent": "#0a84ff" },
};
const agentHtml =
  "<!doctype html><html><head><title>Clearance</title></head><body><p>hello</p></body></html>";

describe("the frame's sandbox flags and policy", () => {
  it("allows scripts and nothing else", () => {
    expect(FRAME_SANDBOX).toBe("allow-scripts");
    // Each of these would give the document a way out of the sandbox.
    for (const flag of [
      "allow-same-origin",
      "allow-forms",
      "allow-popups",
      "allow-modals",
      "allow-top-navigation",
    ])
      expect(FRAME_SANDBOX).not.toContain(flag);
  });

  it("the policy forbids the network, outside resources, forms and nested frames", () => {
    const directives = new Map(
      FRAME_CSP.split(";").map((d) => {
        const [name = "", ...value] = d.trim().split(/\s+/);
        return [name, value.join(" ")] as const;
      }),
    );
    expect(directives.get("default-src")).toBe("'none'");
    expect(directives.get("connect-src")).toBe("'none'");
    expect(directives.get("form-action")).toBe("'none'");
    expect(directives.get("frame-src")).toBe("'none'");
    expect(directives.get("img-src")).toBe("data:");
    expect(directives.get("font-src")).toBe("data:");
    expect(directives.get("script-src")).toBe("'unsafe-inline'");
    expect(directives.get("style-src")).toBe("'unsafe-inline'");
  });
});

describe("frameDocument", () => {
  const doc = frameDocument(agentHtml, theme);

  it("starts with the policy, before any script or style", () => {
    const policy = doc.indexOf("Content-Security-Policy");
    expect(policy).toBeGreaterThan(-1);
    expect(policy).toBeLessThan(doc.indexOf("<script"));
    expect(policy).toBeLessThan(doc.indexOf("<style"));
    expect(doc).toContain(`content="${FRAME_CSP}"`);
  });

  it("carries the runtime once, ahead of the agent's document", () => {
    expect(doc.split(FRAME_RUNTIME)).toHaveLength(2);
    expect(doc.indexOf(FRAME_RUNTIME)).toBeLessThan(doc.indexOf("<p>hello</p>"));
    expect(doc.endsWith(agentHtml)).toBe(true);
  });

  it("puts the theme's tokens and scheme in the document, and the base styles for plain HTML", () => {
    expect(doc).toContain(":root{--panel:#1c1c1e;--ink:#f5f5f7;--accent:#0a84ff;color-scheme:dark;}");
    expect(doc).toContain('data-scheme="dark"');
    for (const rule of ['input[type="range"]', "button {", "output {", "table {"])
      expect(doc).toContain(rule);
    // Sized for a fingertip: buttons and ranges are not small.
    expect(doc).toMatch(/min-height: 40px/);
    expect(doc).toMatch(/input\[type="range"\][^}]*height: 36px/);
  });

  it("a theme value cannot end the style or the tag", () => {
    const hostile = frameDocument("<p>x</p>", {
      scheme: "light",
      vars: { "--panel": "red;} </style><script>alert(1)</script><style>" },
    });
    expect(hostile).not.toContain("<script>alert(1)");
    expect(hostile).not.toContain("</style><script>alert");
  });

  it("the runtime cannot close its own script tag", () => {
    expect(FRAME_RUNTIME.toLowerCase()).not.toContain("</script");
    expect(FRAME_RUNTIME.toLowerCase()).not.toContain("<!--");
  });

  it("the runtime defines hai with exactly the surface the panel API documents", () => {
    for (const part of [
      "scene:",
      "get:",
      "on: on",
      "preview:",
      "commit:",
      '"selection"',
      "scene",
      "theme",
      "problem",
    ])
      expect(FRAME_RUNTIME).toContain(part);
  });
});
