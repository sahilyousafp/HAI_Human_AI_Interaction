import type { ClaudeSetup, ClaudeState } from "@hai/protocol";
import { describe, expect, it } from "vitest";
import { claudeSummary, claudeView } from "./claude-view.ts";

const INFO = {
  command: "irm https://claude.ai/install.ps1 | iex",
  source: "https://claude.ai/install.ps1",
  instructionsUrl: "https://code.claude.com/docs/en/setup",
};
const setup = (state: ClaudeState, prerequisites: ClaudeSetup["prerequisites"] = []): ClaudeSetup => ({
  state,
  prerequisites,
  info: INFO,
});
const ids = (state: ClaudeState) => claudeView(setup(state))?.actions.map((a) => a.id);

describe("claudeView", () => {
  it("says nothing while the app is still looking", () => {
    expect(claudeView(setup({ status: "checking" }))).toBeNull();
  });

  it("ready: confirms with the version and offers only to continue", () => {
    const view = claudeView(setup({ status: "ready", version: "2.1.303" }));
    expect(view).toMatchObject({ tone: "done", headline: "Claude Code is ready" });
    expect(view?.detail).toContain("Version 2.1.303");
    expect(view?.actions).toEqual([{ id: "continue", label: "Continue", primary: true, disabled: false }]);
    expect(view?.command).toBeNull();
  });

  it("not installed: shows the exact command and its source before anything runs, and the manual route", () => {
    const view = claudeView(setup({ status: "missing" }));
    expect(view?.headline).toBe("Install Claude Code");
    expect(view?.command).toEqual({ command: INFO.command, source: INFO.source });
    expect(view?.manualUrl).toBe(INFO.instructionsUrl);
    expect(view?.actions.map((a) => [a.id, a.primary])).toEqual([
      ["install", true],
      ["recheck", false],
      ["skip", false],
    ]);
    expect(view?.detail).toContain("your own Claude account");
  });

  it("installed but did not start: offers to install again, and says it is a problem", () => {
    const view = claudeView(setup({ status: "broken" }));
    expect(view?.tone).toBe("problem");
    expect(view?.headline).toBe("Claude Code did not start");
    expect(ids({ status: "broken" })).toEqual(["install", "recheck", "skip"]);
    expect(view?.command?.command).toBe(INFO.command);
  });

  it("not signed in: sends the user to Claude Code's own window and says the login stays with it", () => {
    const view = claudeView(setup({ status: "signed-out" }));
    expect(view?.headline).toBe("Sign in to Claude");
    expect(view?.detail).toContain("HAI never sees your login");
    expect(view?.command).toBeNull(); // nothing to install: no command to show
    expect(ids({ status: "signed-out" })).toEqual(["signin", "recheck", "skip"]);
  });

  it("installing: shows the installer's output and offers nothing to press", () => {
    const view = claudeView(setup({ status: "installing", output: ["Downloading", "Installing"] }));
    expect(view).toMatchObject({ tone: "busy", headline: "Installing Claude Code", actions: [] });
    expect(view?.output).toEqual(["Downloading", "Installing"]);
    expect(view?.command).toBeNull();
    expect(view?.working).toBe(true);
  });

  it("install failed: keeps the output, says what went wrong, offers another try and the manual instructions", () => {
    const view = claudeView(
      setup({
        status: "install-failed",
        output: ["Access denied"],
        message: "The installer stopped with an error (exit code 2).",
      }),
    );
    expect(view?.tone).toBe("problem");
    expect(view?.detail).toContain("exit code 2");
    expect(view?.output).toEqual(["Access denied"]);
    expect(view?.manualUrl).toBe(INFO.instructionsUrl);
    expect(view?.actions.map((a) => a.id)).toEqual(["install", "skip"]);
  });

  it("waiting for the sign-in: the screen moves on by itself, and the user can also say they are done", () => {
    const view = claudeView(setup({ status: "signing-in" }));
    expect(view?.tone).toBe("busy");
    expect(view?.detail).toContain("moves on by itself");
    expect(view?.actions.map((a) => [a.id, a.primary])).toEqual([
      ["recheck", true],
      ["signin", false],
      ["skip", false],
    ]);
  });

  describe("prerequisites", () => {
    const two = [
      { id: "git", label: "Git for Windows", why: "Gives Claude Code a shell", ok: true },
      { id: "other", label: "Something else", why: "Needed too", ok: false },
    ];

    it("lists each with whether this computer has it, and holds the install back while one is missing", () => {
      const view = claudeView(setup({ status: "missing" }, two));
      expect(view?.prerequisites).toEqual(two);
      expect(view?.detail).toContain("Install what is listed below first");
      expect(view?.actions[0]).toEqual({
        id: "install",
        label: "Install Claude Code",
        primary: true,
        disabled: true,
      });
    });

    it("does not hold anything back when every one is there", () => {
      const view = claudeView(
        setup({ status: "missing" }, [{ ...two[1], ok: true } as (typeof two)[number]]),
      );
      expect(view?.actions[0]?.disabled).toBe(false);
      expect(view?.detail).not.toContain("listed below");
    });

    it("is an empty list today, so nothing is held back", () => {
      const view = claudeView(setup({ status: "missing" }));
      expect(view?.prerequisites).toEqual([]);
      expect(view?.actions[0]?.disabled).toBe(false);
    });
  });

  it("offers the manual instructions on every failure", () => {
    for (const state of [
      { status: "missing" },
      { status: "broken" },
      { status: "install-failed", output: [], message: "x" },
    ] as ClaudeState[]) {
      expect(claudeView(setup(state))?.manualUrl, state.status).toBe(INFO.instructionsUrl);
    }
  });

  it("uses plain words and no em dashes", () => {
    const states: ClaudeState[] = [
      { status: "ready", version: "1" },
      { status: "missing" },
      { status: "broken" },
      { status: "signed-out" },
      { status: "installing", output: [] },
      { status: "install-failed", output: [], message: "m" },
      { status: "signing-in" },
    ];
    for (const state of states) {
      const view = claudeView(setup(state));
      const text = [view?.headline, view?.detail, ...(view?.actions.map((a) => a.label) ?? [])].join(" ");
      expect(text).not.toContain("—");
      expect(text).not.toMatch(/stdout|exit status|PowerShell|auth status/i);
    }
  });
});

describe("claudeSummary", () => {
  it.each<[ClaudeState | null, string]>([
    [null, "Checking"],
    [{ status: "checking" }, "Checking"],
    [{ status: "ready", version: "2.1.303" }, "Ready, version 2.1.303"],
    [{ status: "missing" }, "Not installed"],
    [{ status: "broken" }, "Did not start"],
    [{ status: "signed-out" }, "Not signed in"],
    [{ status: "installing", output: [] }, "Installing"],
    [{ status: "install-failed", output: [], message: "" }, "Install did not finish"],
    [{ status: "signing-in" }, "Waiting for sign-in"],
  ])("%j reads %s", (state, text) => {
    expect(claudeSummary(state ? setup(state) : null)).toBe(text);
  });
});
