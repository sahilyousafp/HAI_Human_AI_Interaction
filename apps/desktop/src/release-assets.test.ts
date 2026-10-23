import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkRelease, checksumLine, parseFeed, writeChecksum } from "../scripts/release-assets.ts";
import type { SignatureReport } from "../scripts/verify-signature.ts";

const VERSION = "1.2.3";
const NAME = `HAI-Setup-${VERSION}.exe`;
const CONTENT = Buffer.from("not really an installer, but bytes all the same");

const feedFor = (
  content: Buffer,
  over: { version?: string; path?: string; sha512?: string; size?: number } = {},
) => {
  const sha512 = over.sha512 ?? createHash("sha512").update(content).digest("base64");
  const path = over.path ?? NAME;
  return `version: ${over.version ?? VERSION}
files:
  - url: ${path}
    sha512: ${sha512}
    size: ${over.size ?? content.length}
path: ${path}
sha512: ${sha512}
releaseDate: '2026-10-23T08:31:18.886Z'
`;
};

/** A folder shaped like electron-builder's output. */
function build(options: { feed?: string; blockmap?: boolean; program?: boolean } = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "hai-release-"));
  writeFileSync(join(dir, NAME), CONTENT);
  writeFileSync(join(dir, "latest.yml"), options.feed ?? feedFor(CONTENT));
  if (options.blockmap !== false) writeFileSync(join(dir, `${NAME}.blockmap`), "map");
  if (options.program !== false) {
    mkdirSync(join(dir, "win-unpacked"));
    writeFileSync(join(dir, "win-unpacked", "HAI.exe"), "exe");
  }
  return dir;
}

const signedBy = (status = "Valid", signer = "CN=HAI Contributors", timestamped = true) => {
  const reader = (files: readonly string[]): SignatureReport[] =>
    files.map((file) => ({ file, status, signer, timestamped }));
  return reader;
};

describe("parseFeed", () => {
  it("reads the version, the path and the file's size and SHA-512", () => {
    const feed = parseFeed(feedFor(CONTENT));
    expect(feed.version).toBe(VERSION);
    expect(feed.path).toBe(NAME);
    expect(feed.files).toEqual([
      { url: NAME, sha512: createHash("sha512").update(CONTENT).digest("base64"), size: CONTENT.length },
    ]);
  });

  it("reads electron-builder's own real output", () => {
    const real = `version: 0.0.0
files:
  - url: HAI-Setup-0.0.0.exe
    sha512: 9yaeiJy1V/4y5a5VNy+mDt43yw0xVWwqes8EKgT8Y/3JRxAaRBhxoJTterN2Z3UyWWJum+e+nyC/Xw6EgS71VA==
    size: 145935742
path: HAI-Setup-0.0.0.exe
sha512: 9yaeiJy1V/4y5a5VNy+mDt43yw0xVWwqes8EKgT8Y/3JRxAaRBhxoJTterN2Z3UyWWJum+e+nyC/Xw6EgS71VA==
releaseDate: '2026-10-23T08:31:18.886Z'
`;
    expect(parseFeed(real).files[0]?.size).toBe(145935742);
  });

  it("says what is missing from a broken feed", () => {
    expect(() => parseFeed("files: []\n")).toThrow(/no "version"/);
  });
});

describe("checkRelease", () => {
  const options = (dir: string, over = {}) => ({ dir, version: VERSION, signatures: signedBy(), ...over });

  it("passes a build whose feed matches its installer and whose files are validly signed", () => {
    const result = checkRelease(options(build()));
    expect(result.problems).toEqual([]);
    expect(result.sha256).toBe(createHash("sha256").update(CONTENT).digest("hex"));
    expect(result.installer).toBe(NAME);
  });

  it("fails the pipeline for an unsigned build, so nothing is published", () => {
    const result = checkRelease(options(build(), { signatures: signedBy("NotSigned", "") }));
    expect(result.problems.join("\n")).toContain("NotSigned");
    expect(result.problems.length).toBeGreaterThan(0);
  });

  it("fails for a signature that is not valid, or has no trusted timestamp, or is from someone else", () => {
    expect(
      checkRelease(options(build(), { signatures: signedBy("HashMismatch") })).problems.length,
    ).toBeGreaterThan(0);
    expect(
      checkRelease(options(build(), { signatures: signedBy("Valid", "CN=HAI Contributors", false) }))
        .problems[0],
    ).toContain("no trusted timestamp");
    expect(
      checkRelease(
        options(build(), { signatures: signedBy("Valid", "CN=Someone Else"), publisher: "HAI Contributors" }),
      ).problems[0],
    ).toContain("not HAI Contributors");
  });

  it("lets an unsigned build through only when that is asked for, and then does not look at signatures", () => {
    let looked = false;
    const result = checkRelease({
      dir: build(),
      version: VERSION,
      allowUnsigned: true,
      signatures: (files) => {
        looked = true;
        return signedBy("NotSigned")(files);
      },
    });
    expect(result.problems).toEqual([]);
    expect(looked).toBe(false);
  });

  it("fails when the update feed's hash is not the installer's, because an update would be refused", () => {
    const result = checkRelease(options(build({ feed: feedFor(CONTENT, { sha512: "AAAA" }) })));
    expect(result.problems.join("\n")).toContain("SHA-512");
  });

  it("fails when the feed's size, version or file name is wrong", () => {
    expect(checkRelease(options(build({ feed: feedFor(CONTENT, { size: 1 }) }))).problems.join()).toContain(
      "size",
    );
    expect(
      checkRelease(options(build({ feed: feedFor(CONTENT, { version: "9.9.9" }) }))).problems.join(),
    ).toContain("version 9.9.9");
    expect(
      checkRelease(options(build({ feed: feedFor(CONTENT, { path: "Other.exe" }) }))).problems.join(),
    ).toContain("Other.exe");
  });

  it("fails when the installer, the feed or the block map was not built", () => {
    const noInstaller = mkdtempSync(join(tmpdir(), "hai-release-"));
    expect(checkRelease(options(noInstaller)).problems[0]).toContain(`${NAME} was not built`);
    const noFeed = build();
    writeFileSync(join(noFeed, "latest.yml"), "");
    expect(() => checkRelease(options(noFeed))).toThrow();
    expect(checkRelease(options(build({ blockmap: false }))).problems.join()).toContain("blockmap");
  });

  it("fails when the program is missing, since its signature cannot be checked", () => {
    expect(checkRelease(options(build({ program: false }))).problems.join()).toContain(
      "win-unpacked/HAI.exe",
    );
  });
});

describe("the checksum file", () => {
  it("is in the format `sha256sum -c` reads: the hash, two spaces, the file name", () => {
    expect(checksumLine("ab12", NAME)).toBe(`ab12  ${NAME}\n`);
  });

  it("is written next to the installer and matches the installer", () => {
    const dir = build();
    const result = checkRelease({ dir, version: VERSION, signatures: signedBy() });
    const file = writeChecksum(dir, { sha256: result.sha256 as string, installer: NAME });
    expect(file).toBe(join(dir, `${NAME}.sha256`));
    expect(readFileSync(file, "utf8")).toBe(
      `${createHash("sha256").update(CONTENT).digest("hex")}  ${NAME}\n`,
    );
  });
});
