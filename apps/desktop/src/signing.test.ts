import { describe, expect, it } from "vitest";
import { SigningError, signingFor } from "../scripts/signing.ts";

const AZURE = {
  AZURE_TENANT_ID: "t",
  AZURE_CLIENT_ID: "c",
  AZURE_CLIENT_SECRET: "s",
  HAI_AZURE_ENDPOINT: "https://weu.codesigning.azure.net",
  HAI_AZURE_PROFILE: "hai-profile",
  HAI_AZURE_ACCOUNT: "hai-account",
  HAI_PUBLISHER_NAME: "CN=HAI Contributors",
};

describe("signingFor", () => {
  it("refuses to build with nothing to sign with, and says what to do instead", () => {
    expect(() => signingFor({})).toThrow(SigningError);
    expect(() => signingFor({})).toThrow(/Smart App Control/);
    expect(() => signingFor({})).toThrow(/dist:unsigned/);
  });

  it("builds unsigned only when that is asked for, with the updater's signature check off", () => {
    for (const asked of [
      { env: { HAI_ALLOW_UNSIGNED: "1" } },
      { env: {}, options: { allowUnsigned: true } },
    ]) {
      const signing = signingFor(asked.env, asked.options);
      expect(signing.mode).toBe("unsigned");
      expect(signing.args).toContain("-c.win.signExecutable=false");
      expect(signing.args).toContain("-c.win.verifyUpdateCodeSignature=false");
    }
  });

  it("does not take 0 or an empty value for a yes", () => {
    expect(() => signingFor({ HAI_ALLOW_UNSIGNED: "0" })).toThrow(SigningError);
    expect(() => signingFor({ HAI_ALLOW_UNSIGNED: "" })).toThrow(SigningError);
  });

  describe("Azure Trusted Signing", () => {
    it("passes the account's details to electron-builder", () => {
      const signing = signingFor(AZURE);
      expect(signing.mode).toBe("azure");
      expect(signing.args).toEqual([
        "-c.win.azureSignOptions.endpoint=https://weu.codesigning.azure.net",
        "-c.win.azureSignOptions.certificateProfileName=hai-profile",
        "-c.win.azureSignOptions.codeSigningAccountName=hai-account",
        "-c.win.azureSignOptions.publisherName=CN=HAI Contributors",
      ]);
    });

    it("never puts a secret on the command line", () => {
      expect(JSON.stringify(signingFor(AZURE).args)).not.toMatch(/"s"|AZURE_CLIENT_SECRET/);
    });

    it("names every variable that is missing", () => {
      const { AZURE_CLIENT_SECRET, HAI_PUBLISHER_NAME, ...partial } = AZURE;
      expect(() => signingFor(partial)).toThrow(/AZURE_CLIENT_SECRET, HAI_PUBLISHER_NAME/);
    });

    it("is not quietly replaced by an unsigned build when it is half set", () => {
      expect(() => signingFor({ AZURE_CLIENT_ID: "c", HAI_ALLOW_UNSIGNED: "1" })).toThrow(SigningError);
    });
  });

  describe("a certificate", () => {
    it("needs the publisher name as well, which the updater checks", () => {
      expect(() => signingFor({ CSC_LINK: "cert.pfx", CSC_KEY_PASSWORD: "p" })).toThrow(/HAI_PUBLISHER_NAME/);
    });

    it("needs its password", () => {
      expect(() => signingFor({ CSC_LINK: "cert.pfx", HAI_PUBLISHER_NAME: "CN=X" })).toThrow(
        /CSC_KEY_PASSWORD/,
      );
    });

    it("lets electron-builder read the certificate itself, and passes the publisher name", () => {
      const signing = signingFor({
        WIN_CSC_LINK: "cert.pfx",
        WIN_CSC_KEY_PASSWORD: "p",
        HAI_PUBLISHER_NAME: "CN=X",
      });
      expect(signing).toEqual({ mode: "certificate", args: ["-c.win.signtoolOptions.publisherName=CN=X"] });
    });
  });
});
