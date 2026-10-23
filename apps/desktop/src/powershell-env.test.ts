import { describe, expect, it } from "vitest";
import { windowsPowerShellEnv } from "../scripts/powershell-env.ts";

describe("windowsPowerShellEnv", () => {
  it("drops an inherited PSModulePath, however it is spelled, and keeps everything else", () => {
    for (const name of ["PSModulePath", "PSMODULEPATH", "psmodulepath"]) {
      const env = windowsPowerShellEnv({ [name]: "/modules/seven", PATH: "/bin", HOME: "h" });
      expect(Object.keys(env).map((k) => k.toLowerCase())).not.toContain("psmodulepath");
      expect(env.PATH).toBe("/bin");
      expect(env.HOME).toBe("h");
    }
  });

  it("adds what it is given, which wins over what was there", () => {
    expect(windowsPowerShellEnv({ A: "1", B: "2" }, { B: "3", C: "4" })).toEqual({ A: "1", B: "3", C: "4" });
  });

  it("does not change the environment it was given", () => {
    const source = { PSModulePath: "x", A: "1" };
    windowsPowerShellEnv(source);
    expect(source).toEqual({ PSModulePath: "x", A: "1" });
  });
});
