import type { Site } from "@hai/protocol";

/** A place as the open data sources give it: degrees, north and east positive. */
export interface GeoPoint {
  lat: number;
  lon: number;
}

const rad = (deg: number) => (deg * Math.PI) / 180;

/** Metres in one degree of latitude and of longitude at this latitude (the WGS84 series, accurate to centimetres). */
function metresPerDegree(latDeg: number): { lat: number; lon: number } {
  const phi = rad(latDeg);
  return {
    lat: 111_132.92 - 559.82 * Math.cos(2 * phi) + 1.175 * Math.cos(4 * phi) - 0.0023 * Math.cos(6 * phi),
    lon: 111_412.84 * Math.cos(phi) - 93.5 * Math.cos(3 * phi) + 0.118 * Math.cos(5 * phi),
  };
}

/**
 * Where a place stands in the model, in millimetres, for a site. The model's +Y is true north turned by the site's
 * north angle (counter-clockwise), the site's anchor point stands at the site's latitude and longitude, and the plane
 * is the local tangent one, which is accurate to centimetres within a couple of kilometres.
 */
export function geoToModel(site: Site, point: GeoPoint): [number, number] {
  const per = metresPerDegree(site.lat);
  const east = (point.lon - site.lon) * per.lon;
  const north = (point.lat - site.lat) * per.lat;
  const a = rad(site.northDeg);
  const x = east * Math.cos(a) - north * Math.sin(a);
  const y = east * Math.sin(a) + north * Math.cos(a);
  return [site.anchorMm[0] + x * 1000, site.anchorMm[1] + y * 1000];
}

/** The place a model point (millimetres) stands at: the inverse of `geoToModel`. */
export function modelToGeo(site: Site, point: readonly [number, number]): GeoPoint {
  const per = metresPerDegree(site.lat);
  const x = (point[0] - site.anchorMm[0]) / 1000;
  const y = (point[1] - site.anchorMm[1]) / 1000;
  const a = rad(site.northDeg);
  const east = x * Math.cos(a) + y * Math.sin(a);
  const north = -x * Math.sin(a) + y * Math.cos(a);
  return { lat: site.lat + north / per.lat, lon: site.lon + east / per.lon };
}

/** The geographic box (south, west, north, east) of a square of this half-side in metres around the site. */
export function siteBox(
  site: Site,
  radiusM: number,
): { south: number; west: number; north: number; east: number } {
  const per = metresPerDegree(site.lat);
  return {
    south: site.lat - radiusM / per.lat,
    north: site.lat + radiusM / per.lat,
    west: site.lon - radiusM / per.lon,
    east: site.lon + radiusM / per.lon,
  };
}
