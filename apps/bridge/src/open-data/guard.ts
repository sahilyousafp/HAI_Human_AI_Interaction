import { lookup as dnsLookup } from "node:dns";
import { isIP } from "node:net";

/** Whether an IPv4 address (dotted) is one a public service lives on: not loopback, private, link-local or reserved. */
function isPublicV4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = parts as [number, number, number, number];
  if (a === 0 || a === 10 || a === 127) return false;
  if (a === 100 && b >= 64 && b <= 127) return false; // carrier-grade NAT
  if (a === 169 && b === 254) return false; // link-local
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0) return false; // protocol assignments and documentation
  if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
  if (a === 198 && b === 51) return false; // documentation
  if (a === 203 && b === 0) return false; // documentation
  return a < 224; // multicast and reserved
}

/** Expands an IPv6 address to its eight 16-bit groups, or null if it is not one. */
function groupsV6(address: string): number[] | null {
  const bare = address.split("%")[0] ?? address;
  const halves = bare.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves[1] ? halves[1].split(":") : [];
  // A trailing dotted IPv4 (::ffff:1.2.3.4) is two groups.
  const dotted = (list: string[]) => {
    const last = list.at(-1);
    if (last?.includes(".")) {
      const v4 = last.split(".").map(Number);
      if (v4.length !== 4 || v4.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
      return [
        ...list.slice(0, -1),
        (((v4[0] as number) << 8) | (v4[1] as number)).toString(16),
        (((v4[2] as number) << 8) | (v4[3] as number)).toString(16),
      ];
    }
    return list;
  };
  const h = dotted(head);
  const t = dotted(tail);
  if (!h || !t) return null;
  const missing = 8 - h.length - t.length;
  if (halves.length === 1 ? h.length !== 8 : missing < 1) return null;
  const all = halves.length === 1 ? h : [...h, ...Array<string>(missing).fill("0"), ...t];
  const numbers = all.map((g) => Number.parseInt(g, 16));
  return numbers.length === 8 && numbers.every((n) => Number.isInteger(n) && n >= 0 && n <= 0xffff)
    ? numbers
    : null;
}

/** Whether an address (IPv4 or IPv6) is one a public service lives on. Anything not understood is not public. */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isPublicV4(address);
  if (family !== 6) return false;
  const g = groupsV6(address);
  if (!g) return false;
  const [g0, g1, g2, g3, g4, g5, g6, g7] = g as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  if (g.every((n) => n === 0)) return false; // ::
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0 && g6 === 0 && g7 === 1)
    return false; // ::1
  // IPv4-mapped (::ffff:a.b.c.d) and the deprecated IPv4-compatible form: judge the address inside.
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && (g5 === 0xffff || g5 === 0))
    return isPublicV4(`${g6 >> 8}.${g6 & 255}.${g7 >> 8}.${g7 & 255}`);
  if ((g0 & 0xfe00) === 0xfc00) return false; // unique local fc00::/7
  if ((g0 & 0xffc0) === 0xfe80) return false; // link-local fe80::/10
  if ((g0 & 0xff00) === 0xff00) return false; // multicast
  if (g0 === 0x2001 && g1 === 0x0db8) return false; // documentation
  if (g0 === 0x0064 && g1 === 0xff9b) return isPublicV4(`${g6 >> 8}.${g6 & 255}.${g7 >> 8}.${g7 & 255}`); // NAT64
  return true;
}

export class PrivateAddressError extends Error {
  constructor(
    readonly host: string,
    readonly address: string,
  ) {
    super(`${host} resolves to ${address}, which is not a public address`);
  }
}

type LookupCallback = (
  error: Error | null,
  address: string | Array<{ address: string; family: number }>,
  family?: number,
) => void;

/**
 * A `lookup` for `https.request` that refuses any host that resolves to a non-public address. It runs at connect
 * time, on the address the socket will use, so there is no gap between the check and the connection (DNS rebinding).
 */
export function guardedLookup(
  resolve: typeof dnsLookup = dnsLookup,
): (hostname: string, options: { all?: boolean; family?: number }, callback: LookupCallback) => void {
  return (hostname, options, callback) => {
    resolve(hostname, { all: true, family: options.family ?? 0 }, (error, addresses) => {
      if (error) {
        callback(error, "");
        return;
      }
      const bad = addresses.find((a) => !isPublicAddress(a.address));
      if (bad) {
        callback(new PrivateAddressError(hostname, bad.address), "");
        return;
      }
      if (options.all) callback(null, addresses);
      else {
        const first = addresses[0];
        if (!first) callback(new Error(`${hostname} did not resolve`), "");
        else callback(null, first.address, first.family);
      }
    });
  };
}

/** A host given as an address literal (rather than a name) is checked directly, before any connection. */
export function literalHostIsPublic(host: string): boolean {
  const bare = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  return isIP(bare) === 0 || isPublicAddress(bare);
}
