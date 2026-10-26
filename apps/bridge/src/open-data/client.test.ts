import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OpenDataRecordEntry } from "@hai/protocol";
import { describe, expect, it, vi } from "vitest";
import { OpenDataClient, OpenDataError, type RawResponse, type Transport } from "./client.ts";
import { envelope } from "./envelope.ts";
import { OpenDataRecord } from "./record.ts";

const json = (value: unknown, status = 200, extra: Record<string, string> = {}): RawResponse => ({
  status,
  headers: { "content-type": "application/json", ...extra },
  body: Buffer.from(JSON.stringify(value)),
});

function setup(
  respond: (
    url: URL,
    init: { method: string; headers: Record<string, string>; body?: string; signal: AbortSignal },
  ) => RawResponse | Promise<RawResponse>,
  options: { allowed?: boolean; cache?: boolean; now?: () => number; hosts?: string[]; gapMs?: number } = {},
) {
  const calls: Array<{ url: string; method: string; headers: Record<string, string>; body?: string }> = [];
  const entries: OpenDataRecordEntry[] = [];
  const record = new OpenDataRecord();
  const cacheDir = options.cache === false ? null : mkdtempSync(join(tmpdir(), "hai-open-data-"));
  const transport: Transport = async (url, init) => {
    calls.push({
      url: url.href,
      method: init.method,
      headers: init.headers,
      ...(init.body ? { body: init.body } : {}),
    });
    return respond(url, init);
  };
  let allowed = options.allowed ?? true;
  const client = new OpenDataClient({
    allows: () => allowed,
    hosts: () => options.hosts ?? ["api.met.no"],
    cacheDir: () => cacheDir,
    userAgent: "HAI/test (open source)",
    record,
    transport,
    sleep: async () => {},
    ...(options.now ? { now: options.now } : {}),
    ...(options.gapMs !== undefined ? { gapMs: options.gapMs } : {}),
  });
  return {
    client,
    calls,
    record,
    entries: () => [...record.entries, ...entries],
    switchOff: () => {
      allowed = false;
    },
  };
}

const forecast = {
  source: "met-norway",
  kind: "weather",
  url: "https://api.met.no/x?lat=1&lon=2",
  ttlMs: 600_000,
};

describe("OpenDataClient requests", () => {
  it("a request to a host of the source returns the body and says who asked", async () => {
    const t = setup(() => json({ ok: true }));
    const response = await t.client.request(forecast);
    expect(JSON.parse(response.body.toString())).toEqual({ ok: true });
    expect(response.cached).toBe(false);
    expect(t.calls[0]?.headers["user-agent"]).toBe("HAI/test (open source)");
  });

  it("is refused at once while Open data (or the source) is off, and nothing is sent", async () => {
    const t = setup(() => json({}), { allowed: false });
    await expect(t.client.request(forecast)).rejects.toMatchObject({ code: "off" });
    expect(t.calls).toEqual([]);
  });

  it("refuses a host that is not the source's, plain http, and a non-URL", async () => {
    const t = setup(() => json({}));
    await expect(t.client.request({ ...forecast, url: "https://evil.example/x" })).rejects.toMatchObject({
      code: "host-not-allowed",
    });
    await expect(t.client.request({ ...forecast, url: "http://api.met.no/x" })).rejects.toMatchObject({
      code: "not-https",
    });
    await expect(t.client.request({ ...forecast, url: "nonsense" })).rejects.toMatchObject({
      code: "host-not-allowed",
    });
    expect(t.calls).toEqual([]);
  });

  it("refuses an address on a private network even when the source lists it", async () => {
    const t = setup(() => json({}), { hosts: ["127.0.0.1", "10.0.0.2", "[::1]"] });
    for (const host of ["127.0.0.1", "10.0.0.2", "[::1]"])
      await expect(t.client.request({ ...forecast, url: `https://${host}/x` })).rejects.toMatchObject({
        code: "private-address",
      });
    expect(t.calls).toEqual([]);
  });

  it("follows a redirect inside the source and stops one that leaves it", async () => {
    const t = setup((url) =>
      url.pathname === "/start"
        ? { status: 302, headers: { location: "/final" }, body: Buffer.alloc(0) }
        : url.pathname === "/leave"
          ? { status: 302, headers: { location: "https://other.example/x" }, body: Buffer.alloc(0) }
          : json({ at: url.pathname }),
    );
    const ok = await t.client.request({ ...forecast, url: "https://api.met.no/start" });
    expect(JSON.parse(ok.body.toString())).toEqual({ at: "/final" });
    expect(ok.url).toBe("https://api.met.no/final");
    await expect(t.client.request({ ...forecast, url: "https://api.met.no/leave" })).rejects.toMatchObject({
      code: "host-not-allowed",
    });
  });

  it("gives up after three redirects", async () => {
    const t = setup(() => ({ status: 302, headers: { location: "/again" }, body: Buffer.alloc(0) }));
    await expect(t.client.request(forecast)).rejects.toMatchObject({ code: "too-many-redirects" });
    expect(t.calls.length).toBe(4);
  });

  it("refuses a content type it did not ask for", async () => {
    const t = setup(() => ({
      status: 200,
      headers: { "content-type": "application/x-msdownload" },
      body: Buffer.from("MZ"),
    }));
    await expect(t.client.request(forecast)).rejects.toMatchObject({ code: "content-type" });
  });

  it("accepts what the request says it accepts", async () => {
    const t = setup(() => ({
      status: 200,
      headers: { "content-type": "image/tiff" },
      body: Buffer.from("II*"),
    }));
    const response = await t.client.request({ ...forecast, accept: ["image/tiff"] });
    expect(response.contentType).toBe("image/tiff");
  });

  it("reports an HTTP error with the host and the status", async () => {
    const t = setup(() => json({}, 500));
    await expect(t.client.request(forecast)).rejects.toThrow(/api\.met\.no answered HTTP 500/);
  });

  it("passes on what the transport says about size and time", async () => {
    const big = setup(() => {
      throw new OpenDataError("too-large", "The answer is larger than 10 bytes.");
    });
    await expect(big.client.request(forecast)).rejects.toMatchObject({ code: "too-large" });
    const slow = setup(
      (_url, init) =>
        new Promise<RawResponse>((_resolve, reject) =>
          init.signal.addEventListener("abort", () => reject(init.signal.reason)),
        ),
      { gapMs: 0 },
    );
    // A transport that never answers is ended by the switch (the timeout uses the same abort).
    const pending = slow.client.request({ ...forecast, ttlMs: 0 });
    await new Promise((r) => setTimeout(r, 5));
    slow.client.cancelAll();
    await expect(pending).rejects.toMatchObject({ code: "off" });
  });
});

describe("OpenDataClient pacing", () => {
  it("pauses a host that asks for it, answers the next request without sending it, and resumes later", async () => {
    let clock = 1_000_000;
    let status = 429;
    const t = setup(() => (status === 429 ? json({}, 429, { "retry-after": "40" }) : json({ ok: 1 })), {
      now: () => clock,
    });
    await expect(t.client.request(forecast)).rejects.toMatchObject({ code: "paused" });
    expect(t.calls.length).toBe(1);
    await expect(t.client.request({ ...forecast, url: "https://api.met.no/y" })).rejects.toMatchObject({
      code: "paused",
    });
    expect(t.calls.length).toBe(1);
    clock += 41_000;
    status = 200;
    await expect(t.client.request({ ...forecast, url: "https://api.met.no/y" })).resolves.toBeTruthy();
  });

  it("sends the requests to one host one at a time", async () => {
    let running = 0;
    let most = 0;
    const t = setup(async () => {
      running++;
      most = Math.max(most, running);
      await new Promise((r) => setTimeout(r, 5));
      running--;
      return json({});
    });
    await Promise.all(
      [1, 2, 3].map((n) => t.client.request({ ...forecast, url: `https://api.met.no/${n}`, ttlMs: 0 })),
    );
    expect(most).toBe(1);
  });
});

describe("OpenDataClient cache and record", () => {
  it("answers a repeat from the cache, with the first fetch time, and sends nothing", async () => {
    let clock = 5_000_000;
    const t = setup(() => json({ n: 1 }), { now: () => clock });
    const first = await t.client.request(forecast);
    clock += 60_000;
    const again = await t.client.request(forecast);
    expect(t.calls.length).toBe(1);
    expect(again.cached).toBe(true);
    expect(again.fetchedAt).toBe(first.fetchedAt);
    expect(again.body.toString()).toBe(first.body.toString());
  });

  it("does not use an entry past its lifetime, or when the lifetime is zero", async () => {
    let clock = 5_000_000;
    const t = setup(() => json({}), { now: () => clock });
    await t.client.request(forecast);
    clock += 700_000;
    await t.client.request(forecast);
    expect(t.calls.length).toBe(2);
    await t.client.request({ ...forecast, ttlMs: 0 });
    await t.client.request({ ...forecast, ttlMs: 0 });
    expect(t.calls.length).toBe(4);
  });

  it("does not serve the cache while Open data is off", async () => {
    const t = setup(() => json({}));
    await t.client.request(forecast);
    t.switchOff();
    await expect(t.client.request(forecast)).rejects.toMatchObject({ code: "off" });
  });

  it("writes each request in the record: host, kind, cached or not, size, and the reason for a failure", async () => {
    const t = setup((url) => (url.pathname === "/bad" ? json({}, 500) : json({ n: 1 })));
    await t.client.request(forecast);
    await t.client.request(forecast);
    await t.client.request({ ...forecast, url: "https://api.met.no/bad" }).catch(() => {});
    await t.client.request({ ...forecast, url: "https://evil.example/x" }).catch(() => {});
    const [a, b, c, d] = t.record.entries;
    expect(a).toMatchObject({ source: "met-norway", host: "api.met.no", kind: "weather", cached: false });
    expect(a?.bytes).toBeGreaterThan(0);
    expect(b).toMatchObject({ cached: true });
    expect(c).toMatchObject({ error: "http" });
    expect(d).toMatchObject({ host: "evil.example", error: "host-not-allowed" });
  });

  it("clearing the record keeps the cache", async () => {
    const t = setup(() => json({}));
    await t.client.request(forecast);
    t.record.clear();
    expect(t.record.entries).toEqual([]);
    await t.client.request(forecast);
    expect(t.calls.length).toBe(1);
  });
});

describe("the result envelope", () => {
  it("names the source, licence and attribution, and how old the observation is", () => {
    const e = envelope(
      "met-norway",
      { t: 12 },
      { fetchedAt: 1_000_000, observedAt: 1_000_000 - 12 * 60_000, cached: false, now: 1_000_000 },
    );
    expect(e).toMatchObject({
      source: "MET Norway",
      licence: "CC BY 4.0 and NLOD",
      cached: false,
      ageMinutes: 12,
      data: { t: 12 },
    });
    expect(e.attribution).toContain("MET Norway");
    expect(e.observedAt).toBe(new Date(1_000_000 - 12 * 60_000).toISOString());
  });

  it("uses the fetch time when the source gives no observation time, and marks inferred values", () => {
    const e = envelope("overpass", [], {
      fetchedAt: 0,
      cached: true,
      now: 3 * 60_000,
      inferred: "levels x 3 m",
    });
    expect(e).toMatchObject({ observedAt: null, ageMinutes: 3, cached: true, inferred: "levels x 3 m" });
  });
});

describe("OpenDataClient timeout", () => {
  it("ends a request that does not answer within the limit, and says so", async () => {
    vi.useFakeTimers();
    try {
      const t = setup(
        (_url, init) =>
          new Promise<RawResponse>((_resolve, reject) =>
            init.signal.addEventListener("abort", () => reject(init.signal.reason)),
          ),
        { gapMs: 0 },
      );
      const pending = t.client.request({ ...forecast, ttlMs: 0 });
      const settled = pending.then(
        () => "answered",
        (e: OpenDataError) => `${e.code}: ${e.message}`,
      );
      await vi.advanceTimersByTimeAsync(10_001);
      expect(await settled).toMatch(/^timeout: No answer within 10 seconds/);
      expect(t.record.entries.at(-1)).toMatchObject({ error: "timeout" });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("OpenDataClient derived results", () => {
  it("works a result out once, then answers from disk until its lifetime ends, and says so in the record", async () => {
    let clock = 9_000_000;
    const t = setup(() => json({}), { now: () => clock });
    let made = 0;
    const produce = async () => {
      made++;
      return { value: { share: 0.31 }, observedAt: 4_000_000 };
    };
    const first = await t.client.derived("met-norway", "vegetation", "area-1", 60_000, produce);
    clock += 30_000;
    const again = await t.client.derived("met-norway", "vegetation", "area-1", 60_000, produce);
    expect(made).toBe(1);
    expect(again).toMatchObject({ value: { share: 0.31 }, cached: true, observedAt: 4_000_000 });
    expect(again.fetchedAt).toBe(first.fetchedAt);
    expect(t.record.entries.at(-1)).toMatchObject({
      kind: "vegetation",
      cached: true,
      host: "(saved result)",
    });
    clock += 40_000;
    await t.client.derived("met-norway", "vegetation", "area-1", 60_000, produce);
    expect(made).toBe(2);
    await t.client.derived("met-norway", "vegetation", "area-2", 60_000, produce);
    expect(made).toBe(3);
  });

  it("is refused while Open data is off, saved result or not", async () => {
    const t = setup(() => json({}));
    await t.client.derived("met-norway", "vegetation", "k", 60_000, async () => ({ value: 1 }));
    t.switchOff();
    await expect(
      t.client.derived("met-norway", "vegetation", "k", 60_000, async () => ({ value: 2 })),
    ).rejects.toMatchObject({ code: "off" });
  });

  it("a request can name its own spacing, and its answer's headers are kept", async () => {
    const t = setup(() => json({}, 200, { "content-range": "bytes 0-9/1000" }), { gapMs: 5000 });
    const response = await t.client.request({ ...forecast, ttlMs: 0, gapMs: 0 });
    expect(response.headers["content-range"]).toBe("bytes 0-9/1000");
  });
});
