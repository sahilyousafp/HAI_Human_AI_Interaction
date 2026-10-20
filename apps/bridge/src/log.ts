/** Keys whose values are never logged, at any depth. */
const SECRET_KEYS = /^(env|headers?|token|authorization|password|secret|api[-_]?key|cookie)$/i;
const REDACTED = "[redacted]";

/**
 * A copy of `value` that is safe to log: values under secret-looking keys are replaced, bearer tokens in strings are
 * masked, and so is any of the given secrets (the session token) wherever it appears.
 */
export function redact(value: unknown, secrets: string[] = []): unknown {
  if (typeof value === "string") {
    let text = value.replace(/\bBearer\s+[^\s"',;]+/gi, `Bearer ${REDACTED}`);
    for (const secret of secrets) if (secret) text = text.split(secret).join(REDACTED);
    return text;
  }
  if (Array.isArray(value)) return value.map((v) => redact(v, secrets));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, v]) => [key, SECRET_KEYS.test(key) ? REDACTED : redact(v, secrets)]),
    );
  }
  return value;
}

export interface Logger {
  info(event: string, details?: Record<string, unknown>): void;
  error(event: string, details?: Record<string, unknown>): void;
}

/** Discards everything (tests, and bridges embedded in other tools). */
export const silentLogger: Logger = { info: () => {}, error: () => {} };

/** One line per event, `[bridge] event {details}`, with every detail redacted first. */
export function createLogger(write: (line: string) => void, secrets: () => string[] = () => []): Logger {
  const line = (event: string, details?: Record<string, unknown>) =>
    write(`[bridge] ${event}${details ? ` ${JSON.stringify(redact(details, secrets()))}` : ""}`);
  return { info: line, error: (event, details) => line(`error: ${event}`, details) };
}
