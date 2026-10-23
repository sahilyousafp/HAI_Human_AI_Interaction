# Maintaining HAI updates: instructions for Claude

How to publish a new version of the installed app so that users can press **Update** in it. Follow this whenever the user asks to update, release or ship the app. It adds to the user's global instructions (no em dashes, no co-author lines in commits, never edit CHANGELOG.md by hand).

## Publishing an update to the installed app

HAI is an installed Windows app. Installed copies update themselves from the **latest normal GitHub release** of `sahilyousafp/HAI_Human_AI_Interaction` (Settings > Setup > Updates, or the pill in the top bar). So "update the app" means: publish a new GitHub release that those copies can find, not just merge code.

Do this whenever the user says to **update the app**, **release it**, **ship it** or **push an update**, in these words or similar. Do not do it for ordinary code changes, and never on your own initiative.

### 1. Confirm before anything is published

Publishing is public and cannot be fully undone, so first tell the user, in a few lines, and wait for a yes:

- **The version number** and why (patch for a fix, minor for a new feature, major for something people must relearn; see `docs/releasing.md`). Read the latest release with `gh release view --repo sahilyousafp/HAI_Human_AI_Interaction --json tagName` and the current `apps/desktop/package.json` version, and propose the next one. Never reuse a version that has been published.
- **What is in it**, from `git log <last tag>..HEAD --oneline`, in plain words.
- **That it is unsigned** if no signing secrets are set up (see "Signing" below), so users click past Windows' warning.
- That it will be published as a **normal release, not a pre-release**.

Also say if the working tree has uncommitted changes, and what you will do about them (commit them first, with the user's agreement).

### 2. Prepare

1. On `main`, up to date, with everything to ship committed. If not, stop and say so.
2. Run `pnpm lint`, `pnpm typecheck` and `pnpm test`. If anything fails, stop and report it; do not release.
3. Set `version` in `apps/desktop/package.json` to the new version (no leading `v`). Commit that on its own: `Release <version> (add-desktop-installer)` style, with the user's commit rules (no co-author line).
4. Run the project's simplify step before the commit, as for any other commit.

### 3. Build and check

From the repository root:

```sh
pnpm --filter @hai/desktop run dist:unsigned
cd apps/desktop
node scripts/release-assets.ts --version <version> --allow-unsigned
```

The second command must print four file paths and exit 0: the installer `HAI-Setup-<version>.exe`, its `.blockmap`, `latest.yml` and the `.sha256`. It checks that `latest.yml` names the same file with the same size and hash. If it fails, stop and report; do not upload.

If the build fails once with `spawn UNKNOWN`, the script has already retried; run it again before reporting.

Check the version really is the new one: `release/latest.yml` says `version: <version>`.

### 4. Tag, push and publish

```sh
git tag -a v<version> -m "HAI <version>"
git push origin main v<version>
gh release create v<version> release/HAI-Setup-<version>.exe release/HAI-Setup-<version>.exe.blockmap release/latest.yml release/HAI-Setup-<version>.exe.sha256 --repo sahilyousafp/HAI_Human_AI_Interaction --title "HAI <version>" --notes-file <notes> --verify-tag --latest
```

(Run `gh` from `apps/desktop`, so the paths above are right.)

- **Never** pass `--prerelease` and never publish a draft: GitHub's "latest release", which installed copies read, skips pre-releases and drafts, so users would not be offered the update.
- All four files go on the release. Without `latest.yml` and the `.blockmap` the app cannot see the update.
- Release notes: plain words for a user, from the commits (what is new, what is fixed). End them with the installer's SHA-256 and, if unsigned, one line saying Windows may show a warning ("More info", then "Run anyway"). Do not edit `CHANGELOG.md` by hand; if a changelog entry is wanted, use the `changelog` skill.
- Pushing a `v*` tag also starts the "Release" workflow on GitHub. Without signing secrets it stops at "Build the installer" and publishes nothing; that is expected and does not affect the release you published by hand. If signing secrets are set up, the workflow publishes the release itself: then do not run `gh release create` (it would collide); wait for the workflow and check its result instead.

### 5. Verify

After publishing, check and tell the user:

- `gh release view v<version> --repo sahilyousafp/HAI_Human_AI_Interaction --json isPrerelease,isDraft,assets` shows `isPrerelease: false`, `isDraft: false` and the four assets.
- `gh release view --repo sahilyousafp/HAI_Human_AI_Interaction --json tagName` (the latest release) is the new tag.
- Download `latest.yml` from the release and check it says the new version.
- Then say plainly: users who have the app installed will be offered the update the next time it checks (on start, or within a day), or at once if they press **Check for updates** in Settings > Setup, and then press **Download** and **Restart to update**.

### Mistakes

- **A wrong or broken release:** do not edit files in a published release. Publish a fixed version as the next patch number. If it is dangerous, delete the release on GitHub (`gh release delete v<version> --yes`, after the user agrees) so nobody is offered it, then publish the fix.
- **A tag on the wrong commit that has not been published as a release:** it can be moved (`git tag -d`, `git push origin :refs/tags/v<version>`, tag again) only with the user's agreement.
- **Never** move or delete a tag that has a published release without the user's explicit say-so.

### Signing

An unsigned installer shows Windows' warning and can be blocked by Smart App Control. Signing needs the repository's secrets (see `docs/desktop.md`, "Signing", and `docs/releasing.md`). Until they exist, releases are unsigned and made by hand as above. When they exist, prefer the pipeline: push the tag, let `.github/workflows/release.yml` build, sign, check and publish, and verify the result. If the user has not set signing up and asks for a "proper" release, say that this is the missing step rather than working around it.

## Other things to know in this repo

- The app is `apps/desktop` (Electron); the web app is `apps/web`; the local bridge is `apps/bridge`. `docs/desktop.md` and `docs/releasing.md` describe how it is built, installed, updated and released.
- Pushes and tags are the user's to ask for. Do not push, tag or publish unless asked, except for the release steps above once the user has confirmed.
- `.agents/` and `openspec/changes/add-generated-panels/` are the user's own untracked work: leave them out of commits.
