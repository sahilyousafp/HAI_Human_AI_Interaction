// The last gate before a release is published: `node scripts/release-assets.ts --version 1.2.3 [--dir release]
// [--allow-unsigned]`. It checks what the build made, writes the checksum file, and prints the files to upload. It exits
// with 1 and writes nothing if anything is wrong, so the pipeline publishes nothing.
//
//   - the installer is named for the version and the update feed (latest.yml) names the same file with the same size and
//     SHA-512, so an update can be verified against what the download page offers;
//   - the installer, and the program inside the build, carry a valid, timestamped signature from the publisher;
//   - the SHA-256 is written next to the installer, in the format `sha256sum -c` reads, and is what the download page shows.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { judge, readSignatures } from "./verify-signature.ts";

export interface FeedFile {
  url: string;
  sha512: string;
  size: number;
}

export interface Feed {
  version: string;
  files: FeedFile[];
  path: string;
  sha512: string;
}

/** The parts of electron-updater's latest.yml that matter here (it is a small, regular file; no YAML library is needed). */
export function parseFeed(text: string): Feed {
  const scalar = (key: string, from = text): string => {
    const found = new RegExp(`^${key}:\\s*'?([^'\\r\\n]+?)'?\\s*$`, "m").exec(from);
    if (!found) throw new Error(`The update feed has no "${key}".`);
    return found[1] as string;
  };
  const files: FeedFile[] = [];
  for (const block of text.split(/^ {2}- /m).slice(1)) {
    const entry = `  - ${block}`;
    const field = (key: string) =>
      new RegExp(`(?:^|\\s)${key}:\\s*'?([^'\\r\\n]+?)'?\\s*$`, "m").exec(entry)?.[1];
    const url = field("url");
    const sha512 = field("sha512");
    const size = field("size");
    if (url && sha512 && size) files.push({ url, sha512, size: Number(size) });
  }
  return { version: scalar("version"), files, path: scalar("path"), sha512: scalar("sha512") };
}

export function hashFile(path: string, algorithm: "sha256" | "sha512", encoding: "hex" | "base64"): string {
  return createHash(algorithm).update(readFileSync(path)).digest(encoding);
}

export interface Check {
  problems: string[];
  sha256?: string;
  installer?: string;
}

export interface CheckOptions {
  dir: string;
  version: string;
  allowUnsigned?: boolean;
  /** The publisher name the signature must carry. */
  publisher?: string;
  /** For tests: the Windows signature reader. */
  signatures?: typeof readSignatures;
}

/** Looks at the files in `dir` and says what is wrong with them; nothing is written. */
export function checkRelease(options: CheckOptions): Check {
  const { dir, version } = options;
  const problems: string[] = [];
  const installerName = `HAI-Setup-${version}.exe`;
  const installer = join(dir, installerName);
  const feedPath = join(dir, "latest.yml");
  if (!existsSync(installer)) return { problems: [`${installerName} was not built in ${dir}.`] };
  if (!existsSync(feedPath)) return { problems: [`latest.yml (the update feed) was not built in ${dir}.`] };

  const feed = parseFeed(readFileSync(feedPath, "utf8"));
  if (feed.version !== version)
    problems.push(`The update feed says version ${feed.version}, not ${version}.`);
  if (feed.path !== installerName)
    problems.push(`The update feed points at ${feed.path}, not ${installerName}.`);
  const entry = feed.files.find((f) => f.url === installerName);
  if (!entry) problems.push(`The update feed does not list ${installerName}.`);
  else {
    if (entry.size !== statSync(installer).size)
      problems.push("The update feed's size is not the installer's size.");
    if (entry.sha512 !== hashFile(installer, "sha512", "base64")) {
      problems.push("The update feed's SHA-512 is not the installer's: an update would be refused.");
    }
  }
  if (!existsSync(`${installer}.blockmap`))
    problems.push(`${installerName}.blockmap is missing (updates download only what changed).`);

  if (!options.allowUnsigned) {
    const program = join(dir, "win-unpacked", "HAI.exe");
    const files = [installer, ...(existsSync(program) ? [program] : [])];
    const verdict = judge((options.signatures ?? readSignatures)(files), { publisher: options.publisher });
    problems.push(...verdict.problems);
    if (!existsSync(program))
      problems.push("The program (win-unpacked/HAI.exe) is missing, so its signature cannot be checked.");
  }
  return { problems, sha256: hashFile(installer, "sha256", "hex"), installer: installerName };
}

/** The checksum file in `sha256sum` format, and the one the download page and the release show. */
export function checksumLine(sha256: string, installerName: string): string {
  return `${sha256}  ${installerName}\n`;
}

export function writeChecksum(dir: string, check: Required<Pick<Check, "sha256" | "installer">>): string {
  const file = join(dir, `${check.installer}.sha256`);
  writeFileSync(file, checksumLine(check.sha256, check.installer));
  return file;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const value = (flag: string) => args[args.indexOf(flag) + 1];
  const version = args.includes("--version") ? value("--version") : undefined;
  if (!version || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
    console.error("Usage: node scripts/release-assets.ts --version 1.2.3 [--dir release] [--allow-unsigned]");
    process.exit(2);
  }
  const dir = args.includes("--dir")
    ? (value("--dir") as string)
    : join(import.meta.dirname, "..", "release");
  const result = checkRelease({
    dir,
    version,
    allowUnsigned: args.includes("--allow-unsigned"),
    publisher: process.env.HAI_PUBLISHER_NAME || undefined,
  });
  if (result.problems.length > 0 || !result.sha256 || !result.installer) {
    for (const problem of result.problems) console.error(`FAIL ${problem}`);
    console.error("\nNothing is published.");
    process.exit(1);
  }
  const checksum = writeChecksum(dir, { sha256: result.sha256, installer: result.installer });
  // One path per line: what the pipeline uploads.
  for (const file of [
    join(dir, result.installer),
    `${join(dir, result.installer)}.blockmap`,
    join(dir, "latest.yml"),
    checksum,
  ]) {
    console.log(file);
  }
}
