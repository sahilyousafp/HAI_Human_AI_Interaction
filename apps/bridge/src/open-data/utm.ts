/** The UTM zone (1 to 60) a longitude falls in. */
export function utmZone(lon: number): number {
  return Math.min(60, Math.max(1, Math.floor((lon + 180) / 6) + 1));
}

/** The EPSG code of a UTM zone on WGS84: 326xx north of the equator, 327xx south. */
export const utmEpsg = (zone: number, lat: number): number => (lat >= 0 ? 32600 : 32700) + zone;

const A = 6378137;
const F = 1 / 298.257223563;
const K0 = 0.9996;
const N = F / (2 - F);
const E2 = F * (2 - F);
const E = Math.sqrt(E2);
/** The rectifying radius times the scale on the central meridian. */
const RADIUS = ((A * K0) / (1 + N)) * (1 + N ** 2 / 4 + N ** 4 / 64 + N ** 6 / 256);
const ALPHA = [
  N / 2 - (2 * N ** 2) / 3 + (5 * N ** 3) / 16 + (41 * N ** 4) / 180,
  (13 * N ** 2) / 48 - (3 * N ** 3) / 5 + (557 * N ** 4) / 1440,
  (61 * N ** 3) / 240 - (103 * N ** 4) / 140,
  (49561 * N ** 4) / 161280,
] as const;

/**
 * WGS84 longitude and latitude (degrees) to UTM easting and northing (metres) in a zone (the longitude's own by
 * default), by Krueger's series (Karney, 2011): millimetres within the zone. South of the equator the northing counts
 * from 10,000,000 m.
 */
export function lonLatToUtm(
  lon: number,
  lat: number,
  zone = utmZone(lon),
): { easting: number; northing: number } {
  const phi = (lat * Math.PI) / 180;
  const lambda = ((lon - ((zone - 1) * 6 - 180 + 3)) * Math.PI) / 180;
  const tau = Math.tan(phi);
  const sigma = Math.sinh(E * Math.atanh((E * tau) / Math.sqrt(1 + tau * tau)));
  const tauPrime = tau * Math.sqrt(1 + sigma * sigma) - sigma * Math.sqrt(1 + tau * tau);
  const xiPrime = Math.atan2(tauPrime, Math.cos(lambda));
  const etaPrime = Math.asinh(Math.sin(lambda) / Math.sqrt(tauPrime * tauPrime + Math.cos(lambda) ** 2));
  let xi = xiPrime;
  let eta = etaPrime;
  ALPHA.forEach((alpha, i) => {
    const j = 2 * (i + 1);
    xi += alpha * Math.sin(j * xiPrime) * Math.cosh(j * etaPrime);
    eta += alpha * Math.cos(j * xiPrime) * Math.sinh(j * etaPrime);
  });
  return { easting: 500_000 + RADIUS * eta, northing: (lat < 0 ? 10_000_000 : 0) + RADIUS * xi };
}
