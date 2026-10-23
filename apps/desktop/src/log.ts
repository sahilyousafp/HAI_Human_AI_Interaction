import { appendFileSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

export interface Logger {
  info(line: string): void;
  error(line: string): void;
  /** Text that must never reach the file (a session token). Any later line has it replaced. */
  addSecret(secret: string): void;
}

export interface LoggerOptions {
  /** How many day files to keep. */
  keep?: number;
  now?: () => Date;
}

const FILE = /^hai-\d{4}-\d{2}-\d{2}\.log$/;
const MIN_SECRET_LENGTH = 8;

/**
 * Writes the app's log to one file per day in `dir`, keeping the last few days. It holds what the desktop app and
 * the bridge print (never camera frames, never a token: secrets added to it are replaced before a line is written).
 * Logging never throws; a log that cannot be written is dropped rather than stopping the app.
 */
export function createLogger(dir: string, options: LoggerOptions = {}): Logger {
  const { keep = 7, now = () => new Date() } = options;
  const secrets = new Set<string>();

  try {
    mkdirSync(dir, { recursive: true });
    const old = readdirSync(dir)
      .filter((name) => FILE.test(name))
      .sort();
    for (const name of old.slice(0, Math.max(0, old.length - (keep - 1))))
      rmSync(join(dir, name), { force: true });
  } catch {
    // no log folder: lines are dropped below
  }

  const write = (level: string, line: string) => {
    let text = line;
    for (const secret of secrets) text = text.split(secret).join("[redacted]");
    const stamp = now().toISOString();
    try {
      appendFileSync(join(dir, `hai-${stamp.slice(0, 10)}.log`), `${stamp} ${level} ${text}\n`);
    } catch {
      // dropped
    }
  };

  return {
    info: (line) => write("INFO", line),
    error: (line) => write("ERROR", line),
    addSecret(secret) {
      if (secret.length >= MIN_SECRET_LENGTH) secrets.add(secret);
    },
  };
}
