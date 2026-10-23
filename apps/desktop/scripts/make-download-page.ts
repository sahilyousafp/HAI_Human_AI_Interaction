// `node scripts/make-download-page.ts --version 1.2.3 [--dir release] [--out site] [--repo owner/name] [--unsigned]`: writes
// the download page (site/index.html) from what the release was built with: the installer's size and SHA-256 are read from
// the files, so the page cannot disagree with the file behind its button.
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type PageInfo, renderDownloadPage } from "./download-page.ts";
import { hashFile } from "./release-assets.ts";

export interface MakeOptions {
  dir: string;
  version: string;
  repo: string;
  signed: boolean;
}

export function pageInfoFor(options: MakeOptions): PageInfo {
  const installerName = `HAI-Setup-${options.version}.exe`;
  const installer = join(options.dir, installerName);
  const sha256 = hashFile(installer, "sha256", "hex");
  // The checksum file the release gate wrote must say the same.
  const written = readFileSync(`${installer}.sha256`, "utf8").trim().split(/\s+/)[0];
  if (written !== sha256)
    throw new Error(`${installerName}.sha256 does not match ${installerName}. Run release-assets.ts again.`);
  const base = `https://github.com/${options.repo}`;
  return {
    version: options.version,
    installerName,
    bytes: statSync(installer).size,
    sha256,
    downloadUrl: `${base}/releases/download/v${options.version}/${installerName}`,
    releaseNotesUrl: `${base}/releases/tag/v${options.version}`,
    sourceUrl: base,
    signed: options.signed,
  };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const value = (flag: string) => args[args.indexOf(flag) + 1];
  const version = args.includes("--version") ? value("--version") : undefined;
  if (!version) {
    console.error(
      "Usage: node scripts/make-download-page.ts --version 1.2.3 [--dir release] [--out site] [--repo owner/name] [--unsigned]",
    );
    process.exit(2);
  }
  const dir = args.includes("--dir")
    ? (value("--dir") as string)
    : join(import.meta.dirname, "..", "release");
  const out = args.includes("--out")
    ? (value("--out") as string)
    : join(import.meta.dirname, "..", "..", "..", "site");
  const repo = args.includes("--repo")
    ? (value("--repo") as string)
    : "sahilyousafp/HAI_Human_AI_Interaction";
  const info = pageInfoFor({ dir, version, repo, signed: !args.includes("--unsigned") });
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "index.html"), renderDownloadPage(info));
  console.log(join(out, "index.html"));
}
