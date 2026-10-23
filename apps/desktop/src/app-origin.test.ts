import { describe, expect, it } from "vitest";
import { APP_ORIGIN, appOrigin } from "./app-origin.ts";

describe("appOrigin", () => {
  it("is hai://app for the installed app", () => {
    expect(APP_ORIGIN).toBe("hai://app");
    expect(appOrigin(undefined, true)).toBe("hai://app");
  });

  it("ignores the dev server variable in an installed app", () => {
    expect(appOrigin("http://127.0.0.1:5174", true)).toBe("hai://app");
  });

  it("uses the dev server from the repository", () => {
    expect(appOrigin("http://127.0.0.1:5174", false)).toBe("http://127.0.0.1:5174");
    expect(appOrigin("http://127.0.0.1:5174/some/path?x=1", false)).toBe("http://127.0.0.1:5174");
  });

  it.each([
    "https://example.com",
    "http://example.com:5174",
    "http://localhost:5174",
    "file:///C:/x",
    "not a url",
    "",
  ])("never shows %s", (url) => {
    expect(appOrigin(url, false)).toBe("hai://app");
  });
});
