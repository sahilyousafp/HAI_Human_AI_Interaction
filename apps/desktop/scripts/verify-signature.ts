// Checks the Authenticode signature of files (Windows): `node scripts/verify-signature.ts <file>...`. Exit code 1 if any file is
// not validly signed. The release pipeline runs it on the installer and nothing is uploaded when it fails.
// --allow-untrusted accepts a signature whose chain does not end in a trusted root (a self-signed certificate, for the test
// of the signing route), but never an unsigned file or one that was altered after signing.
import { spawnSync } from "node:child_process";
import { windowsPowerShellEnv } from "./powershell-env.ts";

export interface SignatureReport {
  file: string;
  /** Authenticode's own word: Valid, NotSigned, HashMismatch, NotTrusted, UnknownError... */
  status: string;
  /** The certificate's subject, or "" when there is none. */
  signer: string;
  /** Whether a trusted timestamp is countersigned, so the signature outlives the certificate. */
  timestamped: boolean;
}

export function readSignatures(files: readonly string[]): SignatureReport[] {
  const script = `
    $ErrorActionPreference = 'Stop'
    # Windows PowerShell 5.1 hands back a JSON array as one object; ForEach-Object spreads it into its items.
    $files = @((ConvertFrom-Json $env:HAI_VERIFY_FILES) | ForEach-Object { $_ })
    $out = foreach ($f in $files) {
      # Some files (those signed through a catalog) answer with more than one object; the first is the file's own.
      $s = @(Get-AuthenticodeSignature -LiteralPath $f)[0]
      [pscustomobject]@{
        file = $f
        status = [string]$s.Status
        signer = if ($s.SignerCertificate) { $s.SignerCertificate.Subject } else { '' }
        timestamped = [bool]$s.TimeStamperCertificate
      }
    }
    ConvertTo-Json -InputObject @($out) -Compress`;
  // The files go in as JSON in the environment: arguments after -Command would be glued onto the command text.
  const run = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    encoding: "utf8",
    env: windowsPowerShellEnv(process.env, { HAI_VERIFY_FILES: JSON.stringify(files) }),
  });
  if (run.status !== 0) throw new Error(`Could not read the signatures: ${run.stderr || run.error?.message}`);
  return JSON.parse(run.stdout) as SignatureReport[];
}

export interface Verdict {
  ok: boolean;
  problems: string[];
}

/** Whether each report is acceptable: valid (or, with `allowUntrusted`, signed with an untrusted root) and timestamped. */
export function judge(
  reports: readonly SignatureReport[],
  options: { allowUntrusted?: boolean; publisher?: string } = {},
): Verdict {
  const problems: string[] = [];
  for (const r of reports) {
    const acceptable =
      r.status === "Valid" ||
      (options.allowUntrusted === true && ["UnknownError", "NotTrusted"].includes(r.status));
    if (!acceptable) problems.push(`${r.file}: signature is ${r.status}${r.signer ? ` (${r.signer})` : ""}`);
    else if (!r.timestamped) problems.push(`${r.file}: signed, but with no trusted timestamp`);
    else if (options.publisher && !r.signer.includes(options.publisher)) {
      problems.push(`${r.file}: signed by ${r.signer}, not ${options.publisher}`);
    }
  }
  return { ok: problems.length === 0, problems };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const files = args.filter((a) => !a.startsWith("--"));
  if (files.length === 0) {
    console.error("Usage: node scripts/verify-signature.ts [--allow-untrusted] <file>...");
    process.exit(2);
  }
  const verdict = judge(readSignatures(files), {
    allowUntrusted: args.includes("--allow-untrusted"),
    publisher: process.env.HAI_PUBLISHER_NAME || undefined,
  });
  for (const problem of verdict.problems) console.error(`FAIL ${problem}`);
  if (!verdict.ok) process.exit(1);
  console.log(`ok: ${files.length} file(s) validly signed`);
}
