import { describe, expect, it } from "vitest";
import { guardedLookup, isPublicAddress, literalHostIsPublic, PrivateAddressError } from "./guard.ts";

describe("public addresses", () => {
  it.each([
    "127.0.0.1",
    "127.1.2.3",
    "10.0.0.5",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "255.255.255.255",
    "198.18.0.1",
    "::",
    "::1",
    "fc00::1",
    "fd12:3456::1",
    "fe80::1",
    "ff02::1",
    "::ffff:127.0.0.1",
    "::ffff:10.1.2.3",
    "::ffff:7f00:1",
    "2001:db8::1",
    "not an address",
    "999.1.1.1",
  ])("%s is not public", (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it.each([
    "8.8.8.8",
    "93.184.216.34",
    "172.32.0.1",
    "172.15.255.255",
    "2606:4700:4700::1111",
    "::ffff:8.8.8.8",
  ])("%s is public", (address) => {
    expect(isPublicAddress(address)).toBe(true);
  });

  it("an address literal host is judged directly, a name is left to the lookup", () => {
    expect(literalHostIsPublic("127.0.0.1")).toBe(false);
    expect(literalHostIsPublic("[::1]")).toBe(false);
    expect(literalHostIsPublic("8.8.8.8")).toBe(true);
    expect(literalHostIsPublic("api.met.no")).toBe(true);
  });
});

describe("the guarded lookup", () => {
  const resolver =
    (addresses: Array<{ address: string; family: number }>) =>
    (_host: string, _options: unknown, callback: (e: Error | null, a: unknown) => void) =>
      callback(null, addresses);

  it("refuses a host whose address is private, even when another address is public (rebinding)", async () => {
    const lookup = guardedLookup(
      resolver([
        { address: "93.184.216.34", family: 4 },
        { address: "127.0.0.1", family: 4 },
      ]) as never,
    );
    const error = await new Promise<Error | null>((resolve) =>
      lookup("rebind.example", { all: true }, (e) => resolve(e)),
    );
    expect(error).toBeInstanceOf(PrivateAddressError);
    expect(error?.message).toContain("127.0.0.1");
  });

  it("returns the addresses of a public host, all of them or the first", async () => {
    const lookup = guardedLookup(resolver([{ address: "93.184.216.34", family: 4 }]) as never);
    const all = await new Promise((resolve) => lookup("ok.example", { all: true }, (_e, a) => resolve(a)));
    expect(all).toEqual([{ address: "93.184.216.34", family: 4 }]);
    const first = await new Promise((resolve) => lookup("ok.example", {}, (_e, a, f) => resolve([a, f])));
    expect(first).toEqual(["93.184.216.34", 4]);
  });

  it("passes a lookup failure on", async () => {
    const lookup = guardedLookup(((_h: string, _o: unknown, cb: (e: Error | null) => void) =>
      cb(new Error("ENOTFOUND"))) as never);
    const error = await new Promise<Error | null>((resolve) =>
      lookup("nowhere.example", {}, (e) => resolve(e)),
    );
    expect(error?.message).toBe("ENOTFOUND");
  });
});
