import { describe, expect, it } from "vitest";
import { loadCameraPrefs, mirroredFor, saveCameraPrefs } from "./camera-prefs.ts";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
}

describe("camera preferences", () => {
  it("defaults to the system camera, not mirrored", () => {
    expect(loadCameraPrefs(memoryStorage())).toEqual({ deviceId: "", mirrored: false });
  });

  it("remembers the chosen camera and each camera's mirrored setting", () => {
    const storage = memoryStorage();
    saveCameraPrefs({ deviceId: "phone", mirrored: true }, storage);
    saveCameraPrefs({ deviceId: "laptop", mirrored: false }, storage);
    expect(loadCameraPrefs(storage)).toEqual({ deviceId: "laptop", mirrored: false });
    expect(mirroredFor("phone", storage)).toBe(true);
    expect(mirroredFor("unknown", storage)).toBe(false);
  });

  it("ignores corrupt stored data", () => {
    expect(loadCameraPrefs(memoryStorage({ "aex.camera": "{not json" }))).toEqual({
      deviceId: "",
      mirrored: false,
    });
  });

  it("keeps working when storage is unavailable or full", () => {
    expect(loadCameraPrefs(null)).toEqual({ deviceId: "", mirrored: false });
    const full = {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(() => saveCameraPrefs({ deviceId: "x", mirrored: true }, full)).not.toThrow();
  });
});
