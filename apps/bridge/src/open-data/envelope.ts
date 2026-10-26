import { OPEN_DATA_SOURCES } from "@hai/protocol";

/** What every open-data result carries, so an agent can say where it came from and how old it is. */
export interface Envelope<T> {
  /** The source's name, as Settings lists it. */
  source: string;
  licence: string;
  /** What the licence asks to be shown next to the data. */
  attribution: string;
  /** When the data was observed or published (ISO 8601), when the source says. */
  observedAt: string | null;
  /** When the app fetched it (ISO 8601); a cached answer keeps its first time. */
  fetchedAt: string;
  /** Minutes from the observation (or, without one, the fetch) to now. */
  ageMinutes: number;
  cached: boolean;
  /** Set when a value was worked out rather than read, and how. */
  inferred?: string;
  data: T;
}

export function envelope<T>(
  sourceId: string,
  data: T,
  when: { fetchedAt: number; observedAt?: number | null; cached: boolean; now?: number; inferred?: string },
): Envelope<T> {
  const source = OPEN_DATA_SOURCES.find((s) => s.id === sourceId);
  const now = when.now ?? Date.now();
  const observed = when.observedAt ?? null;
  return {
    source: source?.name ?? sourceId,
    licence: source?.licence ?? "unknown",
    attribution: source?.attribution ?? "",
    observedAt: observed === null ? null : new Date(observed).toISOString(),
    fetchedAt: new Date(when.fetchedAt).toISOString(),
    ageMinutes: Math.max(0, Math.round((now - (observed ?? when.fetchedAt)) / 60_000)),
    cached: when.cached,
    ...(when.inferred ? { inferred: when.inferred } : {}),
    data,
  };
}
