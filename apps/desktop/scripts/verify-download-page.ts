// `node scripts/verify-download-page.ts <page address>`: opens the download page, follows the button, downloads the file and
// checks that its SHA-256 is the one the page shows. Exit code 1 if anything is off. Run after the page is hosted, and by the
// tests with a local server.
import { createHash } from "node:crypto";
import { readPage } from "./download-page.ts";

export interface Verification {
  ok: boolean;
  problems: string[];
  version: string | null;
}

export async function verifyDownloadPage(
  pageUrl: string,
  doFetch: typeof fetch = fetch,
): Promise<Verification> {
  const problems: string[] = [];
  const page = await doFetch(pageUrl);
  if (!page.ok) return { ok: false, problems: [`The page answered ${page.status}.`], version: null };
  const facts = readPage(await page.text());
  if (!facts.sha256) problems.push("The page shows no SHA-256.");
  if (!facts.downloadUrl) problems.push("The page has no download button.");
  if (!facts.version) problems.push("The page shows no version.");
  if (facts.downloadUrl && facts.sha256) {
    const file = await doFetch(new URL(facts.downloadUrl, pageUrl), { redirect: "follow" });
    if (!file.ok) problems.push(`The button's address answered ${file.status}.`);
    else {
      const hash = createHash("sha256");
      for await (const chunk of file.body as unknown as AsyncIterable<Uint8Array>) hash.update(chunk);
      const actual = hash.digest("hex");
      if (actual !== facts.sha256)
        problems.push(`The file's SHA-256 is ${actual}, not the ${facts.sha256} the page shows.`);
      const name = decodeURIComponent(new URL(facts.downloadUrl, pageUrl).pathname.split("/").pop() ?? "");
      if (facts.version && !name.includes(facts.version))
        problems.push(`The file is called ${name}, which is not version ${facts.version}.`);
    }
  }
  return { ok: problems.length === 0, problems, version: facts.version };
}

if (import.meta.main) {
  const url = process.argv[2];
  if (!url) {
    console.error("Usage: node scripts/verify-download-page.ts <page address>");
    process.exit(2);
  }
  const result = await verifyDownloadPage(url);
  for (const problem of result.problems) console.error(`FAIL ${problem}`);
  if (!result.ok) process.exit(1);
  console.log(`ok: the file behind the button of version ${result.version} matches the page's SHA-256`);
}
