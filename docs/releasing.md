# Releasing a new version of HAI

This is the guide for you, the maintainer: how to ship a new version so that people who installed HAI get it as an update. Users never run any of this. They see an **Update available** pill in HAI, press Download, then Restart to update.

The short version:

```sh
git checkout main
git pull
git tag v0.2.0
git push origin v0.2.0
```

Pushing the tag starts the release pipeline. A few minutes later the release is on GitHub and installed copies can find it. Everything else on this page is what to check before and after, and how to set it up the first time.

## How it works

- **GitHub Releases is where versions live.** Each release holds the installer (`HAI-Setup-<version>.exe`), its block map, the update feed (`latest.yml`) and the checksum. Installed copies of HAI read `latest.yml` from the latest release to find out whether there is something newer.
- **The tag is the version.** The version number comes from the tag you push (`v0.2.0` is version `0.2.0`). The pipeline builds with the tag's version whatever `apps/desktop/package.json` says. That file holds the version a local build (`pnpm --filter @hai/desktop run dist`) gets; set it to the version you are about to tag, in the commit before the tag, so a build on your computer and the release agree. The app reads its version from the build, so Settings > Setup, the top bar and the installer's file name all show it.
- **npm is not involved.** HAI is an installed program, not a package. See [desktop.md](desktop.md) for the installer, signing and updating in detail.

## Choosing the version number

Use `major.minor.patch`:

| Change | Bump | Example |
|---|---|---|
| A fix, nothing new | patch | 0.2.0 to 0.2.1 |
| A new feature, nothing breaks | minor | 0.2.1 to 0.3.0 |
| Something people must relearn or migrate | major | 0.9.0 to 1.0.0 |

While HAI is young, stay on `0.x`: a minor bump can then carry anything. A test version gets a suffix: `v0.3.0-beta.1`. The pipeline publishes it as a **pre-release**, which is the right way to try an update on yourself before everyone gets it.

## Before you tag

1. You are on `main`, up to date, and everything you want to ship is merged.
2. The checks are green: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm licenses:check`, `pnpm credentials:check`. The release pipeline runs them again and stops if any fails.
3. If you changed anything in the first-run screens, the installer or the updater, run the matching check on your computer (each changes the computer for a minute and puts it back):
   - `pnpm --filter @hai/desktop run test:installer` for the installer;
   - `pnpm --filter @hai/desktop run test:update` for a real update from one installed version to the next.
4. Update the changelog from your commit history with the `changelog` skill, not by hand. Merge that too.
5. Decide whether this version is ready for everybody or should be a `-beta.N` first.

## Releasing

```sh
git checkout main
git pull
git tag v0.2.0
git push origin v0.2.0
```

Then watch **Actions > Release** on GitHub. The pipeline:

1. checks the project (lint, tests, licences, the credential boundary);
2. builds the installer with the tag's version;
3. **signs** it, and fails if it cannot (an unsigned installer is never published);
4. checks that the signature is valid, that `latest.yml` matches the installer's size and hash, and that the block map is there;
5. writes the SHA-256 and makes the download page from the real files;
6. publishes the GitHub release.

If a step fails, nothing is published. Read the failing step's log, fix the cause on `main`, delete the tag (`git push origin :refs/tags/v0.2.0` and `git tag -d v0.2.0`) and tag again.

## After it is published

1. Open the release page and check it lists four files: the installer, the `.blockmap`, `latest.yml` and the `.sha256`.
2. Download the installer on a computer that is not yours (or at least one that has never had HAI) and run it once. See that it installs, that the first-run screens appear, and that there is no unexpected Windows warning.
3. On a computer that already has the previous version, open **Settings > Setup > Updates** and press **Check for updates**. The new version should be offered. (Without pressing anything, the pill appears the next time HAI starts, or within a day.)
4. Put the new download page online if you host one. The pipeline keeps it as an artifact of the run (`download-page-<version>`); see "The download page" in [desktop.md](desktop.md). After it is up, check it with `node apps/desktop/scripts/verify-download-page.ts <address>`: it follows the button, downloads the file and checks the SHA-256.
5. Announce it. Release notes are on the release page; GitHub can write a first draft from the merged work.

## First-time setup (once)

Do these before your first real release.

1. **Choose how to sign.** An unsigned installer shows Windows' warning to everyone and can be blocked outright. Pick one:
   - **Azure Trusted Signing**: cheapest and builds trust fastest, but needs an identity check and depends on your country and account type.
   - **A code-signing certificate** from a certificate authority.
2. **Add the secrets to the repository** (Settings > Secrets and variables > Actions). The names are in the table under "Signing" in [desktop.md](desktop.md).
3. **Do a dry run.** Actions > Release > Run workflow. It builds an unsigned version whose files are kept as an artifact and never published. Download the artifact, install it, and check that it works.
4. **Keep the repository public or the releases public.** Installed copies read the release without signing in. A private repository would make every update check fail.

Friends and testers can use an unsigned build while you work out signing: `pnpm --filter @hai/desktop run dist:unsigned`. They will click past Windows' warning ("More info", then "Run anyway"). Never post that file publicly.

## Fixing a bad release

- **Not published yet:** the pipeline stopped. Fix it and tag again (see above).
- **Published with a bug:** ship the fix as the next patch version (`v0.2.1`). Installed copies update to it. This is the normal way.
- **Published and dangerous** (it loses people's work, say): open the release on GitHub and delete it, or mark it as a pre-release so it stops being "latest". Copies that are already installed keep working, and nobody is offered the bad version any more. Then ship the fix.
- **People can turn updates off.** Settings > Setup has a switch for automatic checks, so some copies will stay on an old version until their owner presses Check for updates. That is their choice; nothing breaks.

## What users keep

Updating replaces the program and nothing else. Their projects, settings, downloaded voice models and Claude Code stay where they are. An update is never installed behind their back: it needs a press on Download and a press on Restart, and the restart waits while an agent is working.

## When something goes wrong

| What you see | Likely cause |
|---|---|
| The release job stops at "Build the installer" with "This build would not be signed" | The signing secrets are missing or misspelled. Check the names in [desktop.md](desktop.md). |
| It stops at the check with "NotSigned" or "HashMismatch" | The build was not signed, or something changed the file after signing. Do not work around it: fix the signing. |
| It stops with "The update feed's SHA-512 is not the installer's" | `latest.yml` and the installer came from different builds. Build again from a clean run. |
| The release is there but installed copies never see it | The release is a draft, or private, or marked pre-release while the app is on the stable track. Publish it as a normal release. |
| A computer shows no update pill | It is on the newest version, automatic checks are off, or it is a copy running from the source (the Updates group says so). |
| Windows blocks the installer with no way past | The build is unsigned and Smart App Control is on. Sign it. |
| The build fails once with `spawn UNKNOWN` | Windows' antivirus held a file the build had just written. The build script waits and retries; run it again if it still fails. |

## What each piece is, for reference

| Piece | Where |
|---|---|
| The release pipeline | `.github/workflows/release.yml` |
| The gate that fails the job (signature, feed, checksum) | `apps/desktop/scripts/release-assets.ts` |
| How the build is signed | `apps/desktop/scripts/signing.ts` |
| The download page generator and its check | `apps/desktop/scripts/make-download-page.ts`, `verify-download-page.ts` |
| The updater | `apps/desktop/src/updates.ts` |
| The installer settings | `apps/desktop/electron-builder.yml` |
