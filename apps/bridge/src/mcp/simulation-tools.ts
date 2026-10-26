import type { ContextItem, SceneDocument, Site } from "@hai/protocol";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { type OpenDataClient, OpenDataError } from "../open-data/client.ts";
import type { ContextStore } from "../open-data/context-store.ts";
import { envelope } from "../open-data/envelope.ts";
import { NO_SITE_MESSAGE } from "../open-data/place.ts";
import { type MirroredBox, simulationGeometry } from "../open-data/simulation-geometry.ts";
import { fetchSurfaceTemperature, MAX_SURFACE_RADIUS_M } from "../open-data/surface-temperature.ts";
import { failure, openDataFailure, text } from "./tool-results.ts";

/** What `simulation_geometry` needs: the model, the site, the city context and Rhino's mirrored boxes. */
export interface SimulationTools {
  doc(): SceneDocument;
  site(): Site | null;
  context(): ReadonlyArray<ContextItem>;
  rhino(): ReadonlyArray<MirroredBox>;
}

/** What `surface_temperature` needs: the way out to open data, the site and the layer the overlay goes into. */
export interface SurfaceTools {
  client: OpenDataClient;
  site(): Site | null;
  contextStore: ContextStore;
}

/** Registers `simulation_geometry` (reads the model only, so it is always offered). */
export function registerSimulationGeometry(register: McpServer["registerTool"], deps: SimulationTools): void {
  register(
    "simulation_geometry",
    {
      description:
        "The model as a simplified description in metres with +Z up, for building a simulation model from it (for example in Ladybug Tools): levels, walls (centre line, thickness, base, height), slabs (outline, thickness, top), columns, massings and boxes for imported models, with the site (latitude, longitude, where true north points). With include_context the neighbouring buildings of the context layer come too, as shading objects. The result lists what it simplified or left out (windows, materials, programs): say so in your report. It reads the model and sends nothing anywhere.",
      inputSchema: z.object({
        include_context: z
          .boolean()
          .optional()
          .describe(
            "Also give the neighbouring buildings of the context layer as shading objects (default false)",
          ),
      }),
    },
    async ({ include_context }) =>
      text(
        simulationGeometry({
          doc: deps.doc(),
          site: deps.site(),
          rhino: deps.rhino(),
          ...(include_context ? { context: deps.context() } : {}),
        }),
      ),
  );
}

/** Registers `surface_temperature`; offered only while Open data is on. */
export function registerSurfaceTemperature(register: McpServer["registerTool"], deps: SurfaceTools): void {
  register(
    "surface_temperature",
    {
      description: `The temperature of the ground and roofs around the project's site from the newest Landsat 8 or 9 scene with little cloud (open data): the minimum, mean and maximum in degrees C, optionally the share of the area above a threshold, and a ground overlay in the context layer with a legend. It is SURFACE temperature as seen from above (not air temperature), at 30 m, and the scene is a moment in the past (the result gives its date and age, and a satellite passes every 8 to 16 days): say both when you report. If no scene qualifies you are told when the last one was and receive no values. Needs the site. Radius at most ${MAX_SURFACE_RADIUS_M} m. Only the site's coordinates and the radius are sent.`,
      inputSchema: z.object({
        radius_m: z
          .number()
          .positive()
          .max(MAX_SURFACE_RADIUS_M)
          .optional()
          .describe("Metres around the site (default 300)"),
        max_age_days: z
          .number()
          .int()
          .min(1)
          .max(180)
          .optional()
          .describe("The oldest scene to use, in days (default 45)"),
        max_cloud_percent: z
          .number()
          .min(0)
          .max(100)
          .optional()
          .describe("The most cloud in the scene (default 20)"),
        threshold_c: z
          .number()
          .optional()
          .describe("Also give the share of the area warmer than this, degrees C"),
      }),
    },
    async ({ radius_m, max_age_days, max_cloud_percent, threshold_c }) => {
      try {
        const site = deps.site();
        if (!site) return failure(NO_SITE_MESSAGE);
        const result = await fetchSurfaceTemperature(deps.client, site, radius_m ?? 300, {
          ...(max_age_days !== undefined ? { maxAgeDays: max_age_days } : {}),
          ...(max_cloud_percent !== undefined ? { maxCloudPercent: max_cloud_percent } : {}),
          ...(threshold_c !== undefined ? { thresholdC: threshold_c } : {}),
        });
        deps.contextStore.replace(
          "planetary-computer",
          "raster",
          [result.overlay],
          site,
          result.overlay.date,
        );
        return text(
          envelope("planetary-computer", result.value, {
            fetchedAt: result.fetchedAt,
            observedAt: result.observedAt,
            cached: result.cached,
          }),
        );
      } catch (error) {
        if (error instanceof OpenDataError)
          return openDataFailure(
            error,
            "Tell the user Open data is switched off in Settings > Open data, and do not state a temperature you did not read.",
          );
        throw error;
      }
    },
  );
}
