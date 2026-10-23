import { describe, expect, it } from "vitest";
import { externalTarget, isAppUrl, permissionAllowed } from "./window-rules.ts";

describe("isAppUrl", () => {
  it.each(["hai://app", "hai://app/", "hai://app/assets/index.js", "hai://app/?x=1"])(
    "%s is the app",
    (url) => {
      expect(isAppUrl(url)).toBe(true);
    },
  );

  it.each([
    "https://example.com/",
    "http://127.0.0.1:5173/",
    "hai://app.evil.com/",
    "hai://other/",
    "file:///C:/Windows/win.ini",
    "about:blank",
    "",
  ])("%s is not", (url) => {
    expect(isAppUrl(url)).toBe(false);
  });
});

describe("externalTarget", () => {
  it("passes web addresses to the user's browser", () => {
    expect(externalTarget("https://code.claude.com/docs/en/setup")).toBe(
      "https://code.claude.com/docs/en/setup",
    );
    expect(externalTarget("http://example.com")).toBe("http://example.com/");
  });

  it.each([
    "file:///C:/Windows/System32/calc.exe",
    "javascript:alert(1)",
    "ms-msdt:/id PCWDiagnostic",
    "hai://app/",
    "not a url",
    "",
  ])("opens nothing for %s", (url) => {
    expect(externalTarget(url)).toBeNull();
  });
});

describe("permissionAllowed", () => {
  it("grants the camera and the microphone to the app's pages", () => {
    expect(permissionAllowed("media", "hai://app/", ["video"])).toBe(true);
    expect(permissionAllowed("media", "hai://app/", ["audio", "video"])).toBe(true);
    expect(permissionAllowed("media", "hai://app/")).toBe(true);
  });

  it("refuses the camera to any other page", () => {
    expect(permissionAllowed("media", "https://example.com/", ["video"])).toBe(false);
    expect(permissionAllowed("media", "http://127.0.0.1:5173/", ["video"])).toBe(false);
  });

  it("refuses a media request for anything but audio and video (a screen)", () => {
    expect(permissionAllowed("media", "hai://app/", ["video", "screen"])).toBe(false);
  });

  it.each([
    "geolocation",
    "notifications",
    "clipboard-read",
    "clipboard-sanitized-write",
    "midi",
    "midiSysex",
    "usb",
    "serial",
    "hid",
    "openExternal",
    "fullscreen",
    "display-capture",
    "pointerLock",
    "idle-detection",
    "unknown-future-permission",
  ])("refuses %s even to the app's pages", (permission) => {
    expect(permissionAllowed(permission, "hai://app/")).toBe(false);
  });
});
