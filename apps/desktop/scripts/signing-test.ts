// `pnpm --filter @hai/desktop run test:signing` (Windows): proves that the certificate route of scripts/signing.ts really
// signs what the installer is made of. It makes a throwaway self-signed code-signing certificate (in your user certificate
// store for the minute it takes, then removed), builds the installer with it, and checks with scripts/verify-signature.ts
// that the installer and the program carry a signature with a trusted timestamp and that the uninstaller was signed too.
// A self-signed certificate is not trusted by Windows, so the check runs with --allow-untrusted here; in a release it is
// strict. An unsigned file is the negative control: the same check must reject it.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { windowsPowerShellEnv } from "./powershell-env.ts";
import { judge, readSignatures } from "./verify-signature.ts";

if (process.platform !== "win32") {
  console.error("The signing test runs on Windows only.");
  process.exit(1);
}

const desktopRoot = join(import.meta.dirname, "..");
const outDir = join(desktopRoot, "release-signtest");
const workDir = mkdtempSync(join(tmpdir(), "hai-signtest-"));
const pfx = join(workDir, "test-publisher.pfx");
const PASSWORD = `pw-${Math.random().toString(36).slice(2)}-${Date.now()}`;
const PUBLISHER = "HAI Signing Test";

const failures: string[] = [];
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures.push(what);
};

const powershell = (script: string, env: NodeJS.ProcessEnv = {}) =>
  spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    encoding: "utf8",
    env: windowsPowerShellEnv(process.env, env),
  });

let thumbprint = "";
try {
  // A certificate that lives for a day, made in the user's own store and exported with a password only this run knows.
  const made = powershell(
    `$c = New-SelfSignedCertificate -Type CodeSigningCert -Subject 'CN=${PUBLISHER}' -CertStoreLocation Cert:\\CurrentUser\\My -NotAfter (Get-Date).AddDays(1)
     Export-PfxCertificate -Cert $c -FilePath $env:HAI_PFX -Password (ConvertTo-SecureString $env:HAI_PFX_PASSWORD -AsPlainText -Force) | Out-Null
     $c.Thumbprint`,
    { HAI_PFX: pfx, HAI_PFX_PASSWORD: PASSWORD },
  );
  thumbprint = made.stdout.trim().split(/\r?\n/).pop() ?? "";
  check(existsSync(pfx) && /^[0-9A-F]{40}$/i.test(thumbprint), "a throwaway signing certificate was made");
  if (!existsSync(pfx)) console.log(`     ${made.stderr.trim() || made.stdout.trim()}`);

  rmSync(outDir, { recursive: true, force: true });
  const log: string[] = [];
  const build = spawnSync(
    process.execPath,
    [join(desktopRoot, "scripts", "dist.ts"), "--", `-c.directories.output=${outDir}`],
    {
      cwd: desktopRoot,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, CSC_LINK: pfx, CSC_KEY_PASSWORD: PASSWORD, HAI_PUBLISHER_NAME: PUBLISHER },
    },
  );
  log.push(build.stdout, build.stderr);
  const output = log.join("\n");
  check(build.status === 0, `the build with the certificate succeeded (exit ${build.status})`);
  if (build.status !== 0) console.log(output.split("\n").slice(-25).join("\n"));

  const installer = join(outDir, "HAI-Setup-0.0.0.exe");
  const program = join(outDir, "win-unpacked", "HAI.exe");
  check(existsSync(installer) && existsSync(program), "the installer and the program were built");
  check(
    /signing.*__uninstaller\.exe/i.test(output),
    "the uninstaller was signed before it went into the installer",
  );
  check(!/signing skipped/i.test(output), "nothing was left unsigned on purpose");

  const reports = readSignatures([installer, program]);
  for (const r of reports)
    console.log(`     ${r.file}: ${r.status}, ${r.signer}, timestamped ${r.timestamped}`);
  const verdict = judge(reports, { allowUntrusted: true, publisher: PUBLISHER });
  for (const problem of verdict.problems) console.log(`     ${problem}`);
  check(verdict.ok, "the installer and the program carry the publisher's signature and a trusted timestamp");
  // Strict, as in a release, the same self-signed file is refused: its root is not trusted.
  check(!judge(reports).ok, "a strict check refuses a signature whose root Windows does not trust");

  // The negative control: a file with no signature is rejected by the same check, with or without --allow-untrusted.
  const unsigned = readSignatures([join(desktopRoot, "package.json")]);
  check(!judge(unsigned, { allowUntrusted: true }).ok, "an unsigned file is rejected by the same check");
} finally {
  if (thumbprint)
    powershell(
      `Remove-Item -LiteralPath Cert:\\CurrentUser\\My\\${thumbprint} -Force -ErrorAction SilentlyContinue`,
    );
  rmSync(workDir, { recursive: true, force: true });
  rmSync(outDir, { recursive: true, force: true });
}

const stillThere = thumbprint
  ? powershell(`Test-Path Cert:\\CurrentUser\\My\\${thumbprint}`).stdout.trim() === "True"
  : false;
check(!stillThere, "the throwaway certificate was removed from your store");
if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed.`);
  process.exit(1);
}
console.log("\nThe certificate route signs the installer, the uninstaller and the program.");
