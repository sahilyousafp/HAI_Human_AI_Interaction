import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { formatSize, type PageInfo, readPage, renderDownloadPage } from "../scripts/download-page.ts";
import { pageInfoFor } from "../scripts/make-download-page.ts";
import { verifyDownloadPage } from "../scripts/verify-download-page.ts";

const SHA = "7569ed6aef66f378229fd0e9f90c1bfd2414b9608784585441566902dd7c3469";
const info = (over: Partial<PageInfo> = {}): PageInfo => ({
  version: "1.2.3",
  installerName: "HAI-Setup-1.2.3.exe",
  bytes: 139_200_000,
  sha256: SHA,
  downloadUrl: "https://github.com/o/r/releases/download/v1.2.3/HAI-Setup-1.2.3.exe",
  releaseNotesUrl: "https://github.com/o/r/releases/tag/v1.2.3",
  sourceUrl: "https://github.com/o/r",
  signed: true,
  ...over,
});

describe("renderDownloadPage", () => {
  const page = renderDownloadPage(info());

  it("shows the version, the size, the SHA-256 and a download button that points at the file", () => {
    expect(readPage(page)).toEqual({
      version: "1.2.3",
      sha256: SHA,
      downloadUrl: "https://github.com/o/r/releases/download/v1.2.3/HAI-Setup-1.2.3.exe",
    });
    expect(page).toContain("139 MB");
    expect(page).toContain("Get-FileHash .\\HAI-Setup-1.2.3.exe");
  });

  it("is one self-contained file: no script, no stylesheet or image from elsewhere, no outside request but its links", () => {
    expect(page).not.toMatch(/<script|<link |<img |<iframe|@import|url\(/i);
    const addresses = [...page.matchAll(/(?:href|src)="([^"]+)"/g)].map((m) => m[1]);
    expect(addresses.every((a) => a?.startsWith("https://github.com/o/r"))).toBe(true);
  });

  it("is a proper page: language, title, viewport, light and dark, readable on a phone", () => {
    expect(page).toContain('<html lang="en">');
    expect(page).toContain("<title>HAI, the Human AI Interface</title>");
    expect(page).toContain('name="viewport"');
    expect(page).toContain("prefers-color-scheme: dark");
    expect(page).toContain("clamp(");
  });

  it("uses plain words, with no em dashes", () => {
    expect(page).not.toContain("—");
    expect(page).not.toContain("&mdash;");
  });

  it("says what to expect, in steps a person who has never used a terminal can follow", () => {
    expect(page).toContain("Install it in three steps");
    expect(page).toContain("needs no administrator rights");
    expect(page).toContain("HAI never sees your login");
    expect(page).toContain("never recorded or uploaded");
  });

  it("shows no warning for a signed release, and the way past Windows' warning for an unsigned one", () => {
    expect(page).not.toContain("not signed yet");
    const unsigned = renderDownloadPage(info({ signed: false }));
    expect(unsigned).toContain('data-testid="unsigned-notice"');
    expect(unsigned).toContain("More info");
    expect(unsigned).toContain("Run anyway");
    expect(unsigned).toContain("Smart App Control");
  });

  it("escapes what it is given, so a name or an address cannot break the page", () => {
    const hostile = renderDownloadPage(
      info({ version: '1.0"><script>x</script>', installerName: "<b>.exe" }),
    );
    expect(hostile).not.toContain("<script>");
    expect(hostile).not.toContain("<b>.exe");
    expect(hostile).toContain("&lt;b&gt;.exe");
  });
});

describe("formatSize", () => {
  it.each([
    [139_200_000, "139 MB"],
    [999_400_000, "999 MB"],
    [50_000_000, "50 MB"],
  ])("%d is %s", (bytes, text) => expect(formatSize(bytes)).toBe(text));
});

describe("pageInfoFor", () => {
  const CONTENT = Buffer.from("an installer, for the purposes of a test");
  const make = (checksum?: string) => {
    const dir = mkdtempSync(join(tmpdir(), "hai-page-"));
    writeFileSync(join(dir, "HAI-Setup-2.0.0.exe"), CONTENT);
    const sha = createHash("sha256").update(CONTENT).digest("hex");
    writeFileSync(join(dir, "HAI-Setup-2.0.0.exe.sha256"), `${checksum ?? sha}  HAI-Setup-2.0.0.exe\n`);
    return { dir, sha };
  };

  it("reads the size and the SHA-256 from the files, and points at the release's own address", () => {
    const { dir, sha } = make();
    expect(pageInfoFor({ dir, version: "2.0.0", repo: "me/hai", signed: true })).toEqual({
      version: "2.0.0",
      installerName: "HAI-Setup-2.0.0.exe",
      bytes: CONTENT.length,
      sha256: sha,
      downloadUrl: "https://github.com/me/hai/releases/download/v2.0.0/HAI-Setup-2.0.0.exe",
      releaseNotesUrl: "https://github.com/me/hai/releases/tag/v2.0.0",
      sourceUrl: "https://github.com/me/hai",
      signed: true,
    });
  });

  it("refuses when the checksum file the release gate wrote is not the installer's", () => {
    const { dir } = make("0".repeat(64));
    expect(() => pageInfoFor({ dir, version: "2.0.0", repo: "me/hai", signed: true })).toThrow(
      /does not match/,
    );
  });
});

describe("verifyDownloadPage: the file behind the button matches the page", () => {
  const FILE = Buffer.from("the bytes behind the button");
  let server: Server;
  let base: string;
  let served: Buffer = FILE;

  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === "/") {
        const sha = createHash("sha256").update(FILE).digest("hex");
        res
          .writeHead(200, { "content-type": "text/html" })
          .end(renderDownloadPage(info({ downloadUrl: `${base}/HAI-Setup-1.2.3.exe`, sha256: sha })));
      } else if (req.url === "/HAI-Setup-1.2.3.exe") {
        res.writeHead(200).end(served);
      } else {
        res.writeHead(404).end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it("passes when the file's hash is the one on the page", async () => {
    served = FILE;
    expect(await verifyDownloadPage(`${base}/`)).toEqual({ ok: true, problems: [], version: "1.2.3" });
  });

  it("fails, naming both hashes, when the file is not the one the page describes", async () => {
    served = Buffer.from("something else entirely");
    const result = await verifyDownloadPage(`${base}/`);
    expect(result.ok).toBe(false);
    expect(result.problems[0]).toContain("the page shows");
  });

  it("fails when the page is gone or the button's address is", async () => {
    expect((await verifyDownloadPage(`${base}/missing`)).problems[0]).toContain("404");
    const orphan = createServer((_req, res) => {
      res.writeHead(200).end(renderDownloadPage(info({ downloadUrl: `${base}/nope.exe` })));
    });
    await new Promise<void>((resolve) => orphan.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${(orphan.address() as { port: number }).port}/`;
    const result = await verifyDownloadPage(url);
    await new Promise<void>((resolve) => orphan.close(() => resolve()));
    expect(result.ok).toBe(false);
    expect(result.problems[0]).toContain("404");
  });

  it("reads the page it makes back out, so the check and the generator cannot drift apart", () => {
    const html = renderDownloadPage(info());
    expect(readPage(html).sha256).toBe(SHA);
    expect(readFileSync).toBeDefined();
    mkdirSync(tmpdir(), { recursive: true });
  });
});
