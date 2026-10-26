import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import https from "node:https";
import { join } from "node:path";
import { OPEN_DATA_LIMITS } from "@hai/protocol";
import { guardedLookup, literalHostIsPublic, PrivateAddressError } from "./guard.ts";
import type { OpenDataRecord } from "./record.ts";

export type OpenDataErrorCode =
  | "off"
  | "host-not-allowed"
  | "not-https"
  | "private-address"
  | "timeout"
  | "too-large"
  | "content-type"
  | "too-many-redirects"
  | "paused"
  | "http"
  | "network";

/** A request that did not return data: what went wrong, said so an agent can report it. */
export class OpenDataError extends Error {
  constructor(
    readonly code: OpenDataErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/** One raw answer from a server, before the client judges it. */
export interface RawResponse {
  status: number;
  headers: Record<string, string | undefined>;
  body: Buffer;
}

export interface TransportInit {
  method: "GET" | "POST";
  headers: Record<string, string>;
  body?: string;
  signal: AbortSignal;
  /** The most bytes to read before giving up. */
  maxBytes: number;
}

/** Makes one HTTP request and does not follow redirects. Tests replace it; the default is `httpsTransport`. */
export type Transport = (url: URL, init: TransportInit) => Promise<RawResponse>;

/** The real transport: HTTPS, redirects not followed, the address checked as the socket connects. */
export const httpsTransport: Transport = (url, init) =>
  new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: init.method,
        headers: init.headers,
        signal: init.signal,
        lookup: guardedLookup() as never,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > init.maxBytes) {
            req.destroy();
            reject(new OpenDataError("too-large", `The answer is larger than ${init.maxBytes} bytes.`));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => {
          const headers: Record<string, string | undefined> = {};
          for (const [name, value] of Object.entries(res.headers))
            headers[name] = Array.isArray(value) ? value.join(", ") : value;
          resolve({ status: res.statusCode ?? 0, headers, body: Buffer.concat(chunks) });
        });
        res.on("error", reject);
      },
    );
    req.on("error", (error) => {
      if (error instanceof PrivateAddressError) reject(new OpenDataError("private-address", error.message));
      else if (error.name === "AbortError") reject(error);
      else reject(new OpenDataError("network", error.message));
    });
    if (init.body) req.write(init.body);
    req.end();
  });

export interface OpenDataRequest {
  /** The source id (see OPEN_DATA_SOURCES). */
  source: string;
  /** What it is for, for the record ("weather", "buildings", "portal search"). */
  kind: string;
  url: string;
  method?: "GET" | "POST";
  body?: string;
  headers?: Record<string, string>;
  /** How long a cached answer stays good, ms; 0 never caches. */
  ttlMs: number;
  /** Content types accepted, as prefixes; the default is JSON and text. */
  accept?: readonly string[];
  /** The most bytes of answer; the default is the limit for text and JSON. */
  maxBytes?: number;
  /** The least time since the last request to this host, ms; object stores that serve ranges need none. */
  gapMs?: number;
}

export interface OpenDataResponse {
  body: Buffer;
  contentType: string;
  status: number;
  /** When the answer was fetched (a cached answer keeps its first time). */
  fetchedAt: number;
  cached: boolean;
  /** The URL the answer came from, after redirects. */
  url: string;
  /** The answer's headers, lower-cased (a range request's `content-range` says how large the file is). */
  headers: Record<string, string | undefined>;
}

export interface OpenDataClientOptions {
  /** Whether this source may be contacted now (the Open data switch, the source's own switch, any acknowledgement). */
  allows(source: string): boolean;
  /** The hosts this source may contact. */
  hosts(source: string): readonly string[];
  /** Where cached answers live, or null for no cache. */
  cacheDir(): string | null;
  userAgent: string;
  record: OpenDataRecord;
  transport?: Transport;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** The least time between two requests to one host, ms. */
  gapMs?: number;
}

const DEFAULT_ACCEPT = ["application/json", "application/geo+json", "application/vnd.geo+json", "text/"];
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const SLOW_DOWN = new Set([429, 503]);
const CACHED_BODY_LIMIT = OPEN_DATA_LIMITS.maxJsonBytes;

/**
 * The only way the app reaches an open-data source. It refuses anything but HTTPS to a host of the source, checks every
 * redirect the same way, limits the time and the size of an answer and the kinds of content, spaces requests to one
 * host and pauses when a host asks to be left alone, keeps answers on disk for their lifetime, and writes every request
 * in the record. Switching Open data off ends requests in flight.
 */
export class OpenDataClient {
  private readonly transport: Transport;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly inflight = new Set<AbortController>();
  /** The end of each host's line: requests to one host go one at a time. */
  private readonly lines = new Map<string, Promise<void>>();
  private readonly lastAt = new Map<string, number>();
  private readonly pausedUntil = new Map<string, number>();

  constructor(private readonly options: OpenDataClientOptions) {
    this.transport = options.transport ?? httpsTransport;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  /** Ends the requests in flight (Open data was switched off). */
  cancelAll(): void {
    for (const controller of this.inflight)
      controller.abort(new OpenDataError("off", "Open data was switched off."));
  }

  async request(req: OpenDataRequest): Promise<OpenDataResponse> {
    const started = this.now();
    let host = "";
    try {
      const response = await this.fetchAnswer(req, (h) => {
        host = h;
      });
      this.options.record.add({
        at: started,
        source: req.source,
        host,
        kind: req.kind,
        cached: response.cached,
        bytes: response.body.length,
      });
      return response;
    } catch (error) {
      const failure = error instanceof OpenDataError ? error : new OpenDataError("network", String(error));
      this.options.record.add({
        at: started,
        source: req.source,
        host: host || safeHost(req.url),
        kind: req.kind,
        cached: false,
        bytes: 0,
        error: failure.code,
      });
      throw failure;
    }
  }

  /**
   * A result worked out from several requests (a raster window's statistics, say), kept on disk for its lifetime so a
   * repeat does none of the work and sends nothing. It is refused like any request while Open data is off.
   */
  async derived<T>(
    source: string,
    kind: string,
    key: string,
    ttlMs: number,
    produce: () => Promise<{ value: T; observedAt?: number | null }>,
  ): Promise<{ value: T; fetchedAt: number; observedAt: number | null; cached: boolean }> {
    if (!this.options.allows(source))
      throw new OpenDataError("off", "Open data is off, or this source is switched off in Settings.");
    const dir = this.options.cacheDir();
    const file = dir
      ? join(dir, source, `derived-${createHash("sha1").update(key).digest("hex")}.json`)
      : null;
    if (file) {
      try {
        const entry = JSON.parse(readFileSync(file, "utf8")) as {
          fetchedAt: number;
          observedAt: number | null;
          value: T;
        };
        if (this.now() - entry.fetchedAt <= ttlMs) {
          this.options.record.add({
            at: this.now(),
            source,
            host: "(saved result)",
            kind,
            cached: true,
            bytes: 0,
          });
          return {
            value: entry.value,
            fetchedAt: entry.fetchedAt,
            observedAt: entry.observedAt ?? null,
            cached: true,
          };
        }
      } catch {
        // No saved result: it is worked out now.
      }
    }
    const made = await produce();
    const fetchedAt = this.now();
    const observedAt = made.observedAt ?? null;
    if (file) {
      try {
        mkdirSync(join(file, ".."), { recursive: true });
        writeFileSync(file, JSON.stringify({ fetchedAt, observedAt, value: made.value }));
      } catch {
        // A result that cannot be saved is worked out again next time.
      }
    }
    return { value: made.value, fetchedAt, observedAt, cached: false };
  }

  /** A saved result of `derived` if one is still good; nothing is requested and nothing is worked out. */
  peekDerived<T>(
    source: string,
    key: string,
    ttlMs: number,
  ): { value: T; fetchedAt: number; observedAt: number | null } | null {
    if (!this.options.allows(source)) return null;
    const dir = this.options.cacheDir();
    if (!dir) return null;
    try {
      const file = join(dir, source, `derived-${createHash("sha1").update(key).digest("hex")}.json`);
      const entry = JSON.parse(readFileSync(file, "utf8")) as {
        fetchedAt: number;
        observedAt: number | null;
        value: T;
      };
      return this.now() - entry.fetchedAt <= ttlMs
        ? { value: entry.value, fetchedAt: entry.fetchedAt, observedAt: entry.observedAt ?? null }
        : null;
    } catch {
      return null;
    }
  }

  private async fetchAnswer(req: OpenDataRequest, seen: (host: string) => void): Promise<OpenDataResponse> {
    if (!this.options.allows(req.source))
      throw new OpenDataError("off", "Open data is off, or this source is switched off in Settings.");
    let url = this.checkUrl(req, req.url);
    seen(url.hostname);
    const key = createHash("sha1")
      .update(`${req.method ?? "GET"}\n${url.href}\n${req.body ?? ""}`)
      .digest("hex");
    const cached = this.readCache(req, key);
    if (cached) return cached;

    const controller = new AbortController();
    this.inflight.add(controller);
    const timer = setTimeout(
      () =>
        controller.abort(
          new OpenDataError("timeout", `No answer within ${OPEN_DATA_LIMITS.timeoutMs / 1000} seconds.`),
        ),
      OPEN_DATA_LIMITS.timeoutMs,
    );
    try {
      for (let hops = 0; ; hops++) {
        seen(url.hostname);
        const raw = await this.send(req, url, controller);
        if (REDIRECTS.has(raw.status) && raw.headers.location) {
          if (hops >= OPEN_DATA_LIMITS.maxRedirects)
            throw new OpenDataError("too-many-redirects", "Too many redirects.");
          url = this.checkUrl(req, new URL(raw.headers.location, url).href);
          continue;
        }
        if (SLOW_DOWN.has(raw.status)) {
          const wait = Number(raw.headers["retry-after"]);
          const ms = (Number.isFinite(wait) && wait > 0 ? wait : 30) * 1000;
          this.pausedUntil.set(url.hostname, this.now() + ms);
          throw new OpenDataError(
            "paused",
            `${url.hostname} asked to be left alone for ${Math.round(ms / 1000)} seconds (HTTP ${raw.status}).`,
          );
        }
        if (raw.status < 200 || raw.status >= 300)
          throw new OpenDataError("http", `${url.hostname} answered HTTP ${raw.status}.`);
        const contentType = (raw.headers["content-type"] ?? "").toLowerCase();
        const accept = req.accept ?? DEFAULT_ACCEPT;
        if (!accept.some((prefix) => contentType.startsWith(prefix)))
          throw new OpenDataError(
            "content-type",
            `${url.hostname} sent ${contentType || "no content type"}, which is not accepted here.`,
          );
        const response: OpenDataResponse = {
          body: raw.body,
          contentType,
          status: raw.status,
          fetchedAt: this.now(),
          cached: false,
          url: url.href,
          headers: raw.headers,
        };
        this.writeCache(req, key, response);
        return response;
      }
    } catch (error) {
      if (controller.signal.aborted && controller.signal.reason instanceof OpenDataError)
        throw controller.signal.reason;
      throw error;
    } finally {
      clearTimeout(timer);
      this.inflight.delete(controller);
    }
  }

  /** One request, in its host's line: spaced from the last one, and refused while the host is paused. */
  private async send(req: OpenDataRequest, url: URL, controller: AbortController): Promise<RawResponse> {
    const host = url.hostname;
    const before = this.lines.get(host) ?? Promise.resolve();
    let release = () => {};
    this.lines.set(host, new Promise<void>((resolve) => (release = resolve)));
    try {
      await before;
      const paused = (this.pausedUntil.get(host) ?? 0) - this.now();
      if (paused > 0)
        throw new OpenDataError(
          "paused",
          `${host} asked to be left alone; try again in ${Math.ceil(paused / 1000)} seconds.`,
        );
      const wait = (this.lastAt.get(host) ?? 0) + (req.gapMs ?? this.options.gapMs ?? 250) - this.now();
      if (wait > 0) await this.sleep(wait);
      this.lastAt.set(host, this.now());
      return await this.transport(url, {
        method: req.method ?? "GET",
        headers: { "user-agent": this.options.userAgent, accept: "*/*", ...req.headers },
        ...(req.body !== undefined ? { body: req.body } : {}),
        signal: controller.signal,
        maxBytes: req.maxBytes ?? OPEN_DATA_LIMITS.maxJsonBytes,
      });
    } finally {
      release();
    }
  }

  /** The URL as a URL, if it is HTTPS to a host of the source and not an address literal on a private network. */
  private checkUrl(req: OpenDataRequest, raw: string): URL {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new OpenDataError("host-not-allowed", "That is not a URL.");
    }
    if (url.protocol !== "https:")
      throw new OpenDataError("not-https", "Only HTTPS addresses are contacted.");
    if (!literalHostIsPublic(url.hostname))
      throw new OpenDataError("private-address", `${url.hostname} is not a public address.`);
    if (!this.options.hosts(req.source).includes(url.hostname))
      throw new OpenDataError(
        "host-not-allowed",
        `${url.hostname} is not a host of this source. Hosts are listed in Settings > Open data.`,
      );
    return url;
  }

  private cachePath(req: OpenDataRequest, key: string): string | null {
    const dir = this.options.cacheDir();
    return dir ? join(dir, req.source, `${key}.json`) : null;
  }

  private readCache(req: OpenDataRequest, key: string): OpenDataResponse | null {
    const file = req.ttlMs > 0 ? this.cachePath(req, key) : null;
    if (!file) return null;
    try {
      const entry = JSON.parse(readFileSync(file, "utf8")) as {
        fetchedAt: number;
        contentType: string;
        status: number;
        url: string;
        body: string;
        headers?: Record<string, string | undefined>;
      };
      if (this.now() - entry.fetchedAt > req.ttlMs) return null;
      return {
        body: Buffer.from(entry.body, "base64"),
        contentType: entry.contentType,
        status: entry.status,
        fetchedAt: entry.fetchedAt,
        cached: true,
        url: entry.url,
        headers: entry.headers ?? {},
      };
    } catch {
      return null;
    }
  }

  private writeCache(req: OpenDataRequest, key: string, response: OpenDataResponse): void {
    const file = req.ttlMs > 0 ? this.cachePath(req, key) : null;
    if (!file || response.body.length > CACHED_BODY_LIMIT) return;
    try {
      mkdirSync(join(file, ".."), { recursive: true });
      writeFileSync(
        file,
        JSON.stringify({
          fetchedAt: response.fetchedAt,
          contentType: response.contentType,
          status: response.status,
          url: response.url,
          headers: response.headers,
          body: response.body.toString("base64"),
        }),
      );
    } catch {
      // A cache that cannot be written is a cache that is not there.
    }
  }
}

function safeHost(raw: string): string {
  try {
    return new URL(raw).hostname;
  } catch {
    return "";
  }
}
