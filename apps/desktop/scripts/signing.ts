// How a build of the installer is signed, decided from the environment. Kept apart from the build so it can be tested.
//
// Two routes, whichever you have (see design.md, decision 9):
//   Azure Trusted Signing: AZURE_TENANT_ID, AZURE_CLIENT_ID and AZURE_CLIENT_SECRET (Microsoft's own variables) plus
//     HAI_AZURE_ENDPOINT, HAI_AZURE_PROFILE, HAI_AZURE_ACCOUNT and HAI_PUBLISHER_NAME.
//   A code-signing certificate: CSC_LINK (or WIN_CSC_LINK) and CSC_KEY_PASSWORD, electron-builder's own variables, plus
//     HAI_PUBLISHER_NAME (the name exactly as in the certificate, which the updater checks).
// With neither, the build is refused unless HAI_ALLOW_UNSIGNED=1 (or --unsigned) says that an unsigned installer is
// what is wanted, for a test build or for friends. The release pipeline never sets it.

export type SigningMode = "azure" | "certificate" | "unsigned";

export interface Signing {
  mode: SigningMode;
  /** Arguments for electron-builder. */
  args: string[];
}

export class SigningError extends Error {}

const present = (env: NodeJS.ProcessEnv, name: string): boolean => Boolean(env[name]?.trim());

/** The variables a route needs that are missing. */
function missing(env: NodeJS.ProcessEnv, names: readonly string[]): string[] {
  return names.filter((name) => !present(env, name));
}

export function signingFor(env: NodeJS.ProcessEnv, options: { allowUnsigned?: boolean } = {}): Signing {
  const azureStarted = ["AZURE_CLIENT_ID", "HAI_AZURE_ENDPOINT", "HAI_AZURE_ACCOUNT"].some((n) =>
    present(env, n),
  );
  if (azureStarted) {
    const gaps = missing(env, [
      "AZURE_TENANT_ID",
      "AZURE_CLIENT_ID",
      "AZURE_CLIENT_SECRET",
      "HAI_AZURE_ENDPOINT",
      "HAI_AZURE_PROFILE",
      "HAI_AZURE_ACCOUNT",
      "HAI_PUBLISHER_NAME",
    ]);
    if (gaps.length > 0) {
      throw new SigningError(
        `Signing with Azure Trusted Signing needs these variables too: ${gaps.join(", ")}.`,
      );
    }
    return {
      mode: "azure",
      args: [
        `-c.win.azureSignOptions.endpoint=${env.HAI_AZURE_ENDPOINT}`,
        `-c.win.azureSignOptions.certificateProfileName=${env.HAI_AZURE_PROFILE}`,
        `-c.win.azureSignOptions.codeSigningAccountName=${env.HAI_AZURE_ACCOUNT}`,
        `-c.win.azureSignOptions.publisherName=${env.HAI_PUBLISHER_NAME}`,
      ],
    };
  }
  if (present(env, "CSC_LINK") || present(env, "WIN_CSC_LINK")) {
    const gaps = missing(env, ["HAI_PUBLISHER_NAME"]);
    if (!present(env, "CSC_KEY_PASSWORD") && !present(env, "WIN_CSC_KEY_PASSWORD"))
      gaps.push("CSC_KEY_PASSWORD");
    if (gaps.length > 0) {
      throw new SigningError(`Signing with a certificate needs these variables too: ${gaps.join(", ")}.`);
    }
    return { mode: "certificate", args: [`-c.win.signtoolOptions.publisherName=${env.HAI_PUBLISHER_NAME}`] };
  }
  if (options.allowUnsigned || env.HAI_ALLOW_UNSIGNED === "1") {
    // electron-builder must not pick up a certificate by itself from elsewhere, nor try to sign without one.
    return {
      mode: "unsigned",
      args: ["-c.win.signExecutable=false", "-c.win.verifyUpdateCodeSignature=false"],
    };
  }
  throw new SigningError(
    [
      "This build would not be signed, and an unsigned installer is blocked by Windows Smart App Control and shows a warning to everyone else.",
      "Set the variables for Azure Trusted Signing or for a certificate (see apps/desktop/scripts/signing.ts), or, for a test build or for friends who can click past the warning, run `pnpm --filter @hai/desktop run dist:unsigned`.",
    ].join("\n"),
  );
}
