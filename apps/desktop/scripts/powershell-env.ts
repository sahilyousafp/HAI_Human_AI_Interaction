/**
 * The environment to give Windows PowerShell (powershell.exe, version 5.1) when it is started from a program that may itself be
 * running inside PowerShell 7. A PSModulePath inherited from version 7 hides 5.1's own modules (the certificate drive, the
 * signature commands), so it is not passed on. Names are matched without regard to case, as Windows does: the variable may
 * be spelled PSModulePath or PSMODULEPATH, and an exact-name removal would miss one of them.
 */
export function windowsPowerShellEnv(
  env: NodeJS.ProcessEnv = process.env,
  extra: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
  const clean: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(env)) {
    if (name.toLowerCase() !== "psmodulepath") clean[name] = value;
  }
  return { ...clean, ...extra };
}
