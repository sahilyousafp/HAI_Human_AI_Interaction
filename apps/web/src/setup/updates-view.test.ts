import type { UpdateState } from "@hai/protocol";
import { describe, expect, it } from "vitest";
import { updatesView } from "./updates-view.ts";

const state = (rest: object): UpdateState => ({ current: "1.0.0", autoCheck: true, ...rest }) as UpdateState;

describe("updatesView", () => {
  it("says updating is not available for a copy running from the source, and offers nothing", () => {
    const view = updatesView(state({ status: "unavailable" }));
    expect(view.summary).toBe("Not available here");
    expect(view.detail).toContain("running from the source");
    expect(view.action).toBeNull();
    expect(view.pill).toBeNull();
  });

  it("offers to check, and says whether it ever has", () => {
    expect(updatesView(state({ status: "idle", checkedAt: null })).summary).toBe("Not checked yet");
    const checked = updatesView(state({ status: "idle", checkedAt: "2026-10-23T10:00:00.000Z" }));
    expect(checked.summary).toBe("You have the latest version");
    expect(checked.action).toEqual({ id: "check", label: "Check for updates", disabled: false });
    expect(checked.pill).toBeNull();
  });

  it("shows a check under way, with the button held", () => {
    const view = updatesView(state({ status: "checking" }));
    expect(view.tone).toBe("busy");
    expect(view.action).toEqual({ id: "check", label: "Checking", disabled: true });
  });

  it("tells the user about a new version before it downloads anything, and that restarting is what changes it", () => {
    const view = updatesView(state({ status: "available", version: "1.1.0" }));
    expect(view.summary).toBe("Version 1.1.0 is available");
    expect(view.detail).toContain("You have 1.0.0");
    expect(view.detail).toContain("until you restart");
    expect(view.action).toEqual({ id: "download", label: "Download", disabled: false });
    expect(view.pill).toBe("Update 1.1.0 available");
    expect(view.tone).toBe("attention");
  });

  it("shows progress as a fraction, held between 0 and 1", () => {
    const view = updatesView(state({ status: "downloading", version: "1.1.0", percent: 42 }));
    expect(view.summary).toBe("Downloading version 1.1.0, 42%");
    expect(view.progress).toBeCloseTo(0.42, 5);
    expect(view.action).toBeNull();
    expect(view.pill).toBe("Downloading update 42%");
    expect(updatesView(state({ status: "downloading", version: "1", percent: 250 })).progress).toBe(1);
    expect(updatesView(state({ status: "downloading", version: "1", percent: -5 })).progress).toBe(0);
  });

  it("offers the restart when it can, and holds it while the agent is working, saying why", () => {
    const can = updatesView(state({ status: "ready", version: "1.1.0", canRestart: true }));
    expect(can.action).toEqual({ id: "restart", label: "Restart to update", disabled: false });
    expect(can.detail).toContain("Your work is kept");
    expect(can.pill).toBe("Restart to update");

    const wait = updatesView(state({ status: "ready", version: "1.1.0", canRestart: false }));
    expect(wait.action).toEqual({ id: "restart", label: "Restart when the agent finishes", disabled: true });
    expect(wait.detail).toContain("The agent is working");
    expect(wait.pill).toBe("Update ready");
  });

  it("shows a failure in the app's own words, and offers another try", () => {
    const message =
      "The update could not be installed: sha512 checksum mismatch. HAI 1.0.0 is still installed and works as before.";
    const view = updatesView(state({ status: "error", message }));
    expect(view.summary).toBe("Something went wrong");
    expect(view.detail).toBe(message);
    expect(view.tone).toBe("problem");
    expect(view.action).toEqual({ id: "check", label: "Try again", disabled: false });
  });

  it("uses no em dashes", () => {
    const states = [
      { status: "unavailable" },
      { status: "idle", checkedAt: null },
      { status: "checking" },
      { status: "available", version: "1.1.0" },
      { status: "downloading", version: "1.1.0", percent: 5 },
      { status: "ready", version: "1.1.0", canRestart: true },
      { status: "ready", version: "1.1.0", canRestart: false },
    ];
    for (const s of states) {
      const v = updatesView(state(s));
      expect(JSON.stringify(v)).not.toContain("\u2014");
    }
  });
});
