import { spawn } from "node:child_process";

/** Characters cmd.exe would act on inside a quoted path; a real folder name has none of them, so such a path is refused. */
const UNSAFE_IN_PATH = /[%^&!"<>|\r\n]/;

export interface SignInCommand {
  file: string;
  args: string[];
}

/**
 * The command that opens a visible console window running Claude Code's own sign-in (`claude auth login`), which
 * takes the user to their browser and says in the window how it went. The window stays open after it finishes, so
 * the user can read the result. The app starts it and never reads what it prints: it learns whether the sign-in
 * worked only from `claude auth status`.
 */
export function signInCommand(executable: string, options: { keepOpen?: boolean } = {}): SignInCommand {
  if (UNSAFE_IN_PATH.test(executable)) {
    throw new Error(`Claude Code is at a path that cannot be passed safely to a terminal: ${executable}`);
  }
  const hold = options.keepOpen === false ? "/c" : "/k";
  // `start` opens the new window; the doubled quotes are cmd.exe's way to keep the quotes round a path with spaces.
  return {
    file: "cmd.exe",
    args: ["/d", "/s", "/c", `start "Sign in to Claude" cmd.exe /d ${hold} ""${executable}" auth login"`],
  };
}

type Spawn = typeof spawn;

/**
 * Opens that window and returns at once. Nothing is piped in or out of it (`stdio: "ignore"`), so none of what the
 * sign-in prints, which can include a login link and the account, ever reaches this app.
 */
export async function openSignInTerminal(
  executable: string,
  options: { keepOpen?: boolean; spawnProcess?: Spawn; platform?: string } = {},
): Promise<void> {
  if ((options.platform ?? process.platform) !== "win32") {
    throw new Error(
      "Signing in from here is only available on Windows for now. Run `claude` in a terminal instead.",
    );
  }
  const { file, args } = signInCommand(executable, options);
  const start = options.spawnProcess ?? spawn;
  await new Promise<void>((resolve, reject) => {
    const child = start(file, args, {
      detached: true,
      stdio: "ignore",
      windowsVerbatimArguments: true,
    });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}
