import { Site } from "@hai/protocol";
import type { RawResponse, Transport } from "../src/open-data/client.ts";
import { lonLatToUtm } from "../src/open-data/utm.ts";
import { makeGeoTiff, serveRange } from "./geotiff-fixture.ts";
import { landsatItem, landsatTransport } from "./landsat-fixture.ts";

/**
 * A stand-in for every open-data host, for tests that must never reach the real ones: an Overpass answer around the
 * site, a WorldCover tile, Sentinel-2 bands and a STAC search, and a CKAN portal. It answers like the real services
 * in shape, and records what it was asked.
 */
export interface OpenDataServer {
  transport: Transport;
  /** "METHOD url" of every request it got. */
  calls: string[];
  /** The bodies of its POSTs, to check what was sent. */
  bodies: string[];
  /** The hour its weather answers are for (ISO 8601): the hour that has just begun, whenever the test runs. */
  hour: string;
}

export const TEST_SITE = Site.parse({ lat: 52.37, lon: 4.9 });

/** A closed square of `metres` on a side, `eastM` and `northM` from the site, as OpenStreetMap geometry. */
function square(eastM: number, northM: number, metres: number) {
  const dLat = 1 / 111_250;
  const dLon = 1 / (111_412.84 * Math.cos((52.37 * Math.PI) / 180));
  const p = (e: number, n: number) => ({ lat: 52.37 + n * dLat, lon: 4.9 + e * dLon });
  return [
    p(eastM, northM),
    p(eastM + metres, northM),
    p(eastM + metres, northM + metres),
    p(eastM, northM + metres),
    p(eastM, northM),
  ];
}

export const overpassAnswer = {
  osm3s: { timestamp_osm_base: "2026-10-25T10:00:00Z" },
  elements: [
    {
      type: "way",
      id: 1,
      geometry: square(40, 20, 30),
      tags: { building: "yes", height: "24", name: "Tower" },
    },
    {
      type: "way",
      id: 2,
      geometry: square(-80, 40, 20),
      tags: { building: "house", "building:levels": "3" },
    },
    { type: "way", id: 3, geometry: square(60, -90, 25), tags: { building: "yes" } },
    { type: "node", id: 10, lat: 52.3702, lon: 4.9003, tags: { natural: "tree", height: "9" } },
    { type: "node", id: 11, lat: 52.3697, lon: 4.8996, tags: { natural: "tree" } },
  ],
};

/** The WorldCover tile of the site: trees to the west, built north-east, grass elsewhere. */
function worldCoverTile(): Buffer {
  const width = 400;
  const height = 400;
  const values = Array.from({ length: width * height }, (_, i) => {
    const col = i % width;
    const row = Math.floor(i / width);
    return col < width / 2 ? 10 : row < height / 2 ? 50 : 30;
  });
  return makeGeoTiff({
    width,
    height,
    west: 4.9 - 0.02,
    north: 52.37 + 0.02,
    pixel: 0.0001,
    values,
    epsg: 4326,
  });
}

/** A Sentinel-2 band (UTM 31, 10 m): the west half is green. */
function sentinelBand(red: boolean): Buffer {
  const centre = lonLatToUtm(4.9, 52.37, 31);
  const size = 300;
  const values = Array.from({ length: size * size }, (_, i) => {
    const green = i % size < size / 2;
    return red ? (green ? 2000 : 3000) : green ? 6000 : 3500;
  });
  return makeGeoTiff({
    width: size,
    height: size,
    west: centre.easting - (size / 2) * 10,
    north: centre.northing + (size / 2) * 10,
    pixel: 10,
    values,
    epsg: 32631,
    type: "u16",
  });
}

const json = (value: unknown, type = "application/json"): RawResponse => ({
  status: 200,
  headers: { "content-type": type },
  body: Buffer.from(JSON.stringify(value)),
});

export function openDataServer(): OpenDataServer {
  const calls: string[] = [];
  const bodies: string[] = [];
  const start = Math.floor(Date.now() / 3_600_000) * 3_600_000;
  const iso = (ms: number) => new Date(ms).toISOString().replace(".000Z", "Z");
  const cover = worldCoverTile();
  const red = sentinelBand(true);
  const nir = sentinelBand(false);
  const cogs = "https://sentinel-cogs.s3.us-west-2.amazonaws.com/s2";
  // A Landsat scene a week old, with little cloud (the surface temperature).
  const landsat = landsatTransport({
    qualifying: [landsatItem("LC09_test", new Date(Date.now() - 7 * 86_400_000).toISOString(), 3.2)],
  });
  const transport: Transport = async (url, init) => {
    calls.push(`${init.method} ${url.href}`);
    if (init.body) bodies.push(init.body);
    switch (url.hostname) {
      case "overpass-api.de":
        return json(overpassAnswer);
      case "esa-worldcover.s3.eu-central-1.amazonaws.com":
        return serveRange(cover, init.headers.range);
      case "earth-search.aws.element84.com":
        return json(
          {
            features: [
              {
                id: "S2-test",
                properties: { datetime: "2026-10-20T10:30:00Z", "eo:cloud_cover": 4.2, "proj:epsg": 32631 },
                assets: {
                  red: {
                    href: `${cogs}/red.tif`,
                    "raster:bands": [{ scale: 0.0001, offset: -0.1, nodata: 0 }],
                  },
                  nir: {
                    href: `${cogs}/nir.tif`,
                    "raster:bands": [{ scale: 0.0001, offset: -0.1, nodata: 0 }],
                  },
                },
              },
            ],
          },
          "application/geo+json",
        );
      case "sentinel-cogs.s3.us-west-2.amazonaws.com":
        return serveRange(url.pathname.endsWith("red.tif") ? red : nir, init.headers.range);
      case "planetarycomputer.microsoft.com":
      case "landsateuwest.blob.core.windows.net":
        return landsat(url, init);
      case "api.met.no":
        return json({
          properties: {
            meta: { updated_at: iso(start) },
            timeseries: [
              {
                time: iso(start),
                data: {
                  instant: {
                    details: {
                      air_temperature: 11.5,
                      relative_humidity: 82,
                      wind_speed: 4.2,
                      wind_from_direction: 231,
                      cloud_area_fraction: 75,
                      air_pressure_at_sea_level: 1012.8,
                    },
                  },
                  next_1_hours: { details: { precipitation_amount: 0.2 } },
                },
              },
              { time: iso(start + 3_600_000), data: { instant: { details: { air_temperature: 12.1 } } } },
              { time: iso(start + 7_200_000), data: { instant: { details: { air_temperature: 12.8 } } } },
            ],
          },
        });
      case "api.open-meteo.com":
        return json({
          current: { time: "2026-10-25T10:15", temperature_2m: 10.9, wind_speed_10m: 3.9, cloud_cover: 70 },
          hourly: { time: [], temperature_2m: [] },
        });
      case "power.larc.nasa.gov": {
        const months = [
          "JAN",
          "FEB",
          "MAR",
          "APR",
          "MAY",
          "JUN",
          "JUL",
          "AUG",
          "SEP",
          "OCT",
          "NOV",
          "DEC",
          "ANN",
        ];
        const row = (base: number, swing: number) =>
          Object.fromEntries(
            months.map((m, i) => [m, Math.round((base + swing * Math.sin((i / 12) * Math.PI)) * 10) / 10]),
          );
        return json({
          header: { fill_value: -999, start: 1991, end: 2020 },
          properties: {
            parameter: {
              T2M: row(4, 14),
              RH2M: row(85, -8),
              WS10M: row(5.6, -1.3),
              ALLSKY_SFC_SW_DWN: row(0.6, 4.8),
            },
          },
        });
      }
      case "ckan.publishing.service.gov.uk":
        return url.pathname.includes("package_search")
          ? json({
              success: true,
              result: {
                count: 1,
                results: [
                  {
                    id: "ds-1",
                    name: "street-trees",
                    title: "Street trees",
                    license_title: "CC BY",
                    organization: { title: "City Parks" },
                    metadata_modified: "2026-09-01",
                    resources: [{ id: "res-1", format: "CSV", datastore_active: true }],
                  },
                ],
              },
            })
          : json({
              success: true,
              result: {
                total: 2,
                fields: [{ id: "_id" }, { id: "species" }],
                records: [
                  { _id: 1, species: "plane" },
                  { _id: 2, species: "linden" },
                ],
              },
            });
      default:
        return { status: 404, headers: {}, body: Buffer.alloc(0) };
    }
  };
  return { transport, calls, bodies, hour: iso(start) };
}
