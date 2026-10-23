import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { judge, readSignatures, type SignatureReport } from "../scripts/verify-signature.ts";

const report = (over: Partial<SignatureReport> = {}): SignatureReport => ({
  file: "HAI-Setup-1.0.0.exe",
  status: "Valid",
  signer: "CN=HAI Contributors, O=HAI",
  timestamped: true,
  ...over,
});

describe("judge", () => {
  it("accepts a valid, timestamped signature", () => {
    expect(judge([report()])).toEqual({ ok: true, problems: [] });
  });

  it.each(["NotSigned", "HashMismatch", "NotTrusted", "UnknownError", "Incompatible"])(
    "rejects %s",
    (status) => {
      const verdict = judge([report({ status })]);
      expect(verdict.ok).toBe(false);
      expect(verdict.problems[0]).toContain(status);
    },
  );

  it("rejects a signature with no trusted timestamp: it would stop being valid when the certificate expires", () => {
    expect(judge([report({ timestamped: false })]).problems[0]).toContain("no trusted timestamp");
  });

  it("can accept an untrusted root for the test of the signing route, but never an unsigned or altered file", () => {
    expect(judge([report({ status: "UnknownError" })], { allowUntrusted: true }).ok).toBe(true);
    expect(judge([report({ status: "NotTrusted" })], { allowUntrusted: true }).ok).toBe(true);
    expect(judge([report({ status: "NotSigned" })], { allowUntrusted: true }).ok).toBe(false);
    expect(judge([report({ status: "HashMismatch" })], { allowUntrusted: true }).ok).toBe(false);
  });

  it("checks the publisher when one is expected", () => {
    expect(judge([report()], { publisher: "HAI Contributors" }).ok).toBe(true);
    expect(
      judge([report({ signer: "CN=Someone Else" })], { publisher: "HAI Contributors" }).problems[0],
    ).toContain("not HAI Contributors");
  });

  it("reports every file that fails, by name", () => {
    const verdict = judge([
      report({ file: "a.exe" }),
      report({ file: "b.exe", status: "NotSigned" }),
      report({ file: "c.exe", status: "NotSigned" }),
    ]);
    expect(verdict.problems.map((p) => p.split(":")[0])).toEqual(["b.exe", "c.exe"]);
  });
});

describe.runIf(process.platform === "win32")("readSignatures (Windows)", () => {
  it("reads a Microsoft-signed system file as valid, and an unsigned file as not signed", () => {
    const [signed, unsigned] = readSignatures([
      join(process.env.SystemRoot ?? "C:/Windows", "System32", "notepad.exe"),
      process.execPath,
    ]);
    expect(signed?.status).toBe("Valid");
    expect(signed?.signer).toContain("Microsoft");
    expect(unsigned?.file).toBe(process.execPath);
    expect(typeof unsigned?.status).toBe("string");
  });
});
