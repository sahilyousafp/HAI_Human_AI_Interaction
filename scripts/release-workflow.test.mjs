import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The release workflow cannot run in a unit test, so what must never change about it is pinned here, from its text:
// a version tag publishes, only a manual run may be unsigned, and nothing is published without passing the gate.
const text = readFileSync(join(import.meta.dirname, "..", ".github", "workflows", "release.yml"), "utf8");
// A GitHub expression, built here because the text of a workflow is full of them and a lint rule flags them in strings.
const expr = (inner) => `$${"{"}{ ${inner} }}`;
const step = (name) => {
  const start =
    text.indexOf(`- name: ${name}`) >= 0 ? text.indexOf(`- name: ${name}`) : text.indexOf(`- name: "${name}`);
  expect(start, `a step called ${name}`).toBeGreaterThan(-1);
  const next = text.indexOf("\n      - ", start + 10);
  return text.slice(start, next === -1 ? undefined : next);
};

describe(".github/workflows/release.yml", () => {
  it("runs on version tags, and by hand as a dry run", () => {
    expect(text).toMatch(/push:\s*\n\s*tags: \["v\*"\]/);
    expect(text).toContain("workflow_dispatch:");
    expect(text).toContain(
      `DRY_RUN: ${expr("github.event_name == 'workflow_dispatch' && 'true' || 'false'")}`,
    );
  });

  it("allows an unsigned build only in a dry run", () => {
    expect(step("Build the installer")).toContain(
      `HAI_ALLOW_UNSIGNED: ${expr("env.DRY_RUN == 'true' && '1' || '0'")}`,
    );
    expect(text.match(/HAI_ALLOW_UNSIGNED/g)).toHaveLength(1); // set nowhere else
    // No command builds an unsigned installer: not the `dist:unsigned` script, not dist.ts with --unsigned.
    expect(text).not.toMatch(/dist:unsigned|dist\.ts[^\n]*--unsigned/);
  });

  it("checks the build (signature, feed, checksum) before anything is published", () => {
    const check = step("Check what was built");
    expect(check).toContain("node scripts/release-assets.ts");
    expect(check).toContain('if [ "$DRY_RUN" = "true" ]; then flags="--allow-unsigned"; fi');
    expect(text.indexOf("Check what was built")).toBeLessThan(text.indexOf("Publish the release"));
  });

  it("publishes only for a tag, never in a dry run, and keeps a dry run's files as an artifact instead", () => {
    expect(step("Publish the release")).toContain("if: env.DRY_RUN != 'true'");
    expect(step("Dry run: keep the files as an artifact")).toContain("if: env.DRY_RUN == 'true'");
    expect(text.match(/gh release create/g)).toHaveLength(1);
  });

  it("makes the download page from the release's own files, after the gate and before anything is published", () => {
    const page = step("Make the download page");
    expect(page).toContain("node scripts/make-download-page.ts");
    // A page for an unsigned build says so; it never claims a signature that is not there.
    expect(page).toContain(
      'if [ "$DRY_RUN" = "true" ] || [ -z "$HAI_PUBLISHER_NAME" ]; then flags="--unsigned"; fi',
    );
    expect(text.indexOf("Check what was built")).toBeLessThan(text.indexOf("Make the download page"));
    expect(text.indexOf("Make the download page")).toBeLessThan(text.indexOf("Publish the release"));
  });

  it("runs the project's own checks first, so what ships passes its rules", () => {
    for (const command of ["pnpm lint", "pnpm test", "pnpm licenses:check", "pnpm credentials:check"]) {
      expect(text).toContain(`- run: ${command}`);
      expect(text.indexOf(`- run: ${command}`)).toBeLessThan(text.indexOf("Build the installer"));
    }
  });

  it("gets its version from the tag, and refuses one that is not a version", () => {
    // The shell takes the tag's name and drops its leading v.
    expect(text).toMatch(/version="\$\{GITHUB_REF_NAME#v\}"/);
    expect(text).toContain("is not a version");
  });

  it("takes signing secrets from the repository, and never writes one into the file", () => {
    for (const name of ["AZURE_CLIENT_SECRET", "CSC_LINK", "CSC_KEY_PASSWORD"]) {
      expect(text).toContain(`${name}: ${expr(`secrets.${name}`)}`);
    }
    expect(text).not.toMatch(/(?:secret|password)\s*[:=]\s*['"]?[A-Za-z0-9+/]{16,}/i);
  });

  it("uploads the installer, its block map, the update feed and the checksum, which the gate lists", () => {
    expect(text).toContain("gh release create");
    expect(text).toContain("--verify-tag");
    const gate = readFileSync(
      join(import.meta.dirname, "..", "apps", "desktop", "scripts", "release-assets.ts"),
      "utf8",
    );
    for (const part of [".blockmap", "latest.yml", "writeChecksum"]) expect(gate).toContain(part);
  });
});
