import { type Site, STARTER_PORTALS } from "@hai/protocol";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { type OpenDataClient, OpenDataError } from "../open-data/client.ts";
import type { ContextStore } from "../open-data/context-store.ts";
import { envelope } from "../open-data/envelope.ts";
import { urbanMetrics } from "../open-data/metrics.ts";
import { fetchBuildings, MAX_RADIUS_M } from "../open-data/overpass.ts";
import { NO_SITE_MESSAGE } from "../open-data/place.ts";
import {
  detectKind,
  type PortalKind,
  readDataset,
  searchPortal,
  starterKind,
  TABLE_ROW_LIMIT,
} from "../open-data/portals.ts";
import {
  fetchGreenness,
  fetchLandCover,
  MAX_VEGETATION_RADIUS_M,
  savedLandCover,
} from "../open-data/vegetation.ts";
import { failure, text } from "./tool-results.ts";

/** What Urban's tools need: the way out to open data, the site, the portals and the layer they fill. */
export interface UrbanTools {
  client: OpenDataClient;
  site(): Site | null;
  /** The hosts the user added; the starter list is the app's own. */
  portalHosts(): readonly string[];
  context: ContextStore;
}

/** A tool body that turns a refused or failed request into a message the agent can act on. */
async function guarded(body: () => Promise<ReturnType<typeof text>>) {
  try {
    return await body();
  } catch (error) {
    if (error instanceof OpenDataError) {
      const advice =
        error.code === "off"
          ? " Tell the user Open data is switched off (Settings > Open data) and do not guess the data."
          : "";
      return failure(`${error.message} (${error.code})${advice}`);
    }
    throw error;
  }
}

const KIND = z.enum(["ckan", "socrata", "arcgis-hub"]);

/** Registers Urban's tools: portals, buildings, vegetation and urban metrics. Offered only while Open data is on. */
export function registerUrbanTools(register: McpServer["registerTool"], deps: UrbanTools): void {
  const portalKind = async (host: string, given: PortalKind | undefined): Promise<PortalKind> => {
    const listed = [...STARTER_PORTALS.map((p) => p.host), ...deps.portalHosts()];
    if (!listed.includes(host))
      throw new OpenDataError(
        "host-not-allowed",
        `${host} is not one of the portals. Hosts are listed in Settings > Open data > Portals; the user can add it there.`,
      );
    return given ?? starterKind(host) ?? (await detectKind(deps.client, host));
  };
  const needSite = (): Site | null => deps.site();

  register(
    "open_data_search",
    {
      description:
        "Searches the catalogue of an open-data portal for datasets by text (CKAN, Socrata and ArcGIS Hub portals): title, publisher, licence, date, formats and which resources read as a table. The portal must be one listed in Settings > Open data (the starter list and the hosts the user added; open_data_sources lists them). Only your search text is sent.",
      inputSchema: z.object({
        portal: z
          .string()
          .describe("A portal host from open_data_sources, e.g. ckan.publishing.service.gov.uk"),
        query: z.string().trim().min(1).max(200).describe("What to look for"),
        limit: z.number().int().min(1).max(20).optional().describe("How many datasets (default 8)"),
        kind: KIND.optional().describe(
          "The platform, for a portal the user added (found by asking if left out)",
        ),
      }),
    },
    async ({ portal, query, limit, kind }) =>
      guarded(async () => {
        const platform = await portalKind(portal.toLowerCase(), kind);
        const found = await searchPortal(deps.client, portal.toLowerCase(), platform, query, limit ?? 8);
        return text(
          envelope(
            "portals",
            { portal, platform, total: found.total ?? null, datasets: found.datasets },
            { fetchedAt: found.fetchedAt, cached: found.cached },
          ),
        );
      }),
  );

  register(
    "open_data_get",
    {
      description: `Reads a dataset's table from an open-data portal: its columns and at most ${TABLE_ROW_LIMIT} rows (it says when rows were left out and how many the dataset has). Use the dataset id (and for CKAN a resource id marked as a table) from open_data_search. Datasets the portal serves from another host cannot be read until the user adds that host in Settings.`,
      inputSchema: z.object({
        portal: z.string().describe("The portal host"),
        dataset: z.string().min(1).max(120).describe("The dataset id from open_data_search"),
        resource: z.string().max(120).optional().describe("For CKAN: the resource id of a table"),
        limit: z.number().int().min(1).max(TABLE_ROW_LIMIT).optional().describe("How many rows (default 50)"),
        kind: KIND.optional(),
      }),
    },
    async ({ portal, dataset, resource, limit, kind }) =>
      guarded(async () => {
        const host = portal.toLowerCase();
        const platform = await portalKind(host, kind);
        const read = await readDataset(deps.client, host, platform, dataset, resource, limit ?? 50);
        return text(
          envelope(
            "portals",
            { portal, platform, dataset, ...read.table },
            { fetchedAt: read.fetchedAt, cached: read.cached },
          ),
        );
      }),
  );

  register(
    "urban_buildings",
    {
      description: `Fetches the buildings (and, unless you turn it off, the trees) within a radius of the project's site from OpenStreetMap, and puts them in the model's context layer (drawn read-only beside the model, seen in everyone's pictures and in sun studies). Heights are marked: measured (the source gave one), inferred (three metres a level) or a default of nine metres. Needs the site (open_data_sources says if it is set). Radius at most ${MAX_RADIUS_M} m. The public server can take up to a minute for a dense district (a repeat of the same question is answered at once); a smaller radius is faster. Read what was fetched with context_get; it returns counts, not the items. Only the site's coordinates and the radius are sent.`,
      inputSchema: z.object({
        radius_m: z
          .number()
          .positive()
          .max(MAX_RADIUS_M)
          .optional()
          .describe("Metres around the site (default 300)"),
        include_trees: z.boolean().optional().describe("Also fetch trees (default true)"),
      }),
    },
    async ({ radius_m, include_trees }) =>
      guarded(async () => {
        const site = needSite();
        if (!site) return failure(NO_SITE_MESSAGE);
        const radius = radius_m ?? 300;
        const wantTrees = include_trees ?? true;
        const fetched = await fetchBuildings(deps.client, site, radius, wantTrees);
        const observed = fetched.observedAt === null ? null : new Date(fetched.observedAt).toISOString();
        const kept = deps.context.replace("overpass", "building", fetched.buildings, site, observed);
        const treesKept = wantTrees
          ? deps.context.replace("overpass", "tree", fetched.trees, site, observed)
          : { kept: 0, dropped: 0 };
        const heights = { measured: 0, inferred: 0, default: 0 };
        for (const b of fetched.buildings) heights[b.heightSource] += 1;
        const worked = heights.inferred + heights.default;
        return text(
          envelope(
            "overpass",
            {
              radiusM: radius,
              buildings: {
                fetched: fetched.buildings.length,
                inTheLayer: kept.kept,
                leftOut: kept.dropped,
                heights,
              },
              ...(wantTrees
                ? {
                    trees: {
                      fetched: fetched.trees.length,
                      inTheLayer: treesKept.kept,
                      leftOut: treesKept.dropped,
                    },
                  }
                : {}),
              note: "They are in the context layer now (read them with context_get). Buildings drawn from relations (some large or complex ones) are not included.",
            },
            {
              fetchedAt: fetched.fetchedAt,
              observedAt: fetched.observedAt,
              cached: fetched.cached,
              ...(worked > 0
                ? {
                    inferred: `${worked} of ${fetched.buildings.length} heights are worked out (three metres a level) or a nine metre default`,
                  }
                : {}),
            },
          ),
        );
      }),
  );

  register(
    "urban_vegetation",
    {
      description: `Vegetation cover around the project's site: the share of tree, shrub, grass, built and other cover from the 10 m ESA WorldCover map (2021), and the greenness (NDVI) of the newest Sentinel-2 scene with little cloud, as statistics and as a ground overlay in the context layer with a legend. Needs the site. Radius at most ${MAX_VEGETATION_RADIUS_M} m. The cover is a 2021 map and the scene is days to weeks old: say both dates when you report. Only the site's coordinates and the radius are sent.`,
      inputSchema: z.object({
        radius_m: z
          .number()
          .positive()
          .max(MAX_VEGETATION_RADIUS_M)
          .optional()
          .describe("Metres around the site (default 200)"),
        overlay: z.boolean().optional().describe("Draw the greenness on the ground (default true)"),
        max_cloud_percent: z
          .number()
          .min(0)
          .max(100)
          .optional()
          .describe("The most cloud in the scene (default 15)"),
      }),
    },
    async ({ radius_m, overlay, max_cloud_percent }) =>
      guarded(async () => {
        const site = needSite();
        if (!site) return failure(NO_SITE_MESSAGE);
        const radius = radius_m ?? 200;
        const cover = await fetchLandCover(deps.client, site, radius);
        let greenness: unknown;
        try {
          const green = await fetchGreenness(deps.client, site, radius, {
            overlay: overlay ?? true,
            ...(max_cloud_percent !== undefined ? { maxCloudPercent: max_cloud_percent } : {}),
          });
          if (green.overlay)
            deps.context.replace("earth-search", "raster", [green.overlay], site, green.overlay.date);
          greenness = envelope("earth-search", green.value, {
            fetchedAt: green.fetchedAt,
            observedAt: green.observedAt,
            cached: green.cached,
          });
        } catch (error) {
          if (error instanceof OpenDataError && error.code === "off") throw error;
          greenness = { unavailable: error instanceof Error ? error.message : String(error) };
        }
        return text({
          landCover: envelope("worldcover", cover.value, {
            fetchedAt: cover.fetchedAt,
            cached: cover.cached,
          }),
          greenness,
        });
      }),
  );

  register(
    "urban_metrics",
    {
      description: `Urban metrics of the square around the project's site (radius at most ${MAX_RADIUS_M} m), from what the context layer holds: building coverage ratio, footprint-weighted mean and tallest building height, the share of heights that were measured, tree count, and the green share. A metric whose data was never fetched is reported as missing with the tool to fetch it, never guessed: fetch with urban_buildings and urban_vegetation (the green share needs urban_vegetation with the same radius, at most ${MAX_VEGETATION_RADIUS_M} m). Each metric says what it rests on.`,
      inputSchema: z.object({
        radius_m: z
          .number()
          .positive()
          .max(MAX_RADIUS_M)
          .optional()
          .describe("Metres around the site (default 300)"),
      }),
    },
    async ({ radius_m }) =>
      guarded(async () => {
        const site = needSite();
        if (!site) return failure(NO_SITE_MESSAGE);
        const radius = radius_m ?? 300;
        const saved = radius <= MAX_VEGETATION_RADIUS_M ? savedLandCover(deps.client, site, radius) : null;
        const metrics = urbanMetrics({
          items: deps.context.items,
          site,
          radiusM: radius,
          buildingsFetched: deps.context.wasFetched("overpass", "building"),
          treesFetched: deps.context.wasFetched("overpass", "tree"),
          greenShare: saved
            ? { value: saved.greenShare, basis: `ESA WorldCover ${saved.year}: tree, shrub and grass cover` }
            : null,
        });
        const credits = deps.context.credits();
        return text({
          ...metrics,
          basis: credits.map((c) => ({ source: c.source, attribution: c.attribution, date: c.date })),
          layerStale: deps.context.stale,
          ...(deps.context.stale
            ? {
                warning:
                  "The layer was built for another site than the project has now: fetch it again before relying on these.",
              }
            : {}),
        });
      }),
  );
}
