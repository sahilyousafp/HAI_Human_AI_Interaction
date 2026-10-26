import type { Site } from "@hai/protocol";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { type OpenDataClient, OpenDataError } from "../open-data/client.ts";
import { envelope } from "../open-data/envelope.ts";
import { placeFor } from "../open-data/place.ts";
import { climateNormals, weatherForecast, weatherNow, weatherOrder } from "../open-data/weather.ts";
import { failure, text } from "./tool-results.ts";

/** What the weather tools need: the way out to open data, the site and which sources may be used now. */
export interface WeatherTools {
  client: OpenDataClient;
  site(): Site | null;
  allows(sourceId: string): boolean;
}

const PLACE = {
  latitude: z
    .number()
    .min(-90)
    .max(90)
    .optional()
    .describe("Degrees, north positive (default: the project's site)"),
  longitude: z
    .number()
    .min(-180)
    .max(180)
    .optional()
    .describe("Degrees, east positive (default: the project's site)"),
};

const SOURCE = z
  .enum(["nws", "met-norway", "open-meteo"])
  .optional()
  .describe(
    "Use this source only (default: the National Weather Service in the US, else MET Norway, else Open-Meteo)",
  );

async function guarded(body: () => Promise<ReturnType<typeof text>>) {
  try {
    return await body();
  } catch (error) {
    if (error instanceof OpenDataError) {
      const advice =
        error.code === "off"
          ? " Tell the user Open data (or the weather source) is switched off in Settings > Open data, and do not state weather you did not read."
          : "";
      return failure(`${error.message} (${error.code})${advice}`);
    }
    throw error;
  }
}

/** Registers `weather_now`, `weather_forecast` and `climate_normals`; offered only while Open data is on. */
export function registerWeatherTools(register: McpServer["registerTool"], deps: WeatherTools): void {
  register(
    "weather_now",
    {
      description:
        "The weather now at the project's site (or coordinates you give): air temperature (degrees C), humidity, wind speed (m/s) and direction, cloud cover, precipitation and pressure, from open services (the National Weather Service in the US, MET Norway, Open-Meteo). The result says which source answered, when the values hold and how many minutes old they are: say so when you report. Only the place is sent.",
      inputSchema: z.object({ ...PLACE, source: SOURCE }),
    },
    async ({ latitude, longitude, source }) =>
      guarded(async () => {
        const place = placeFor(deps.site(), { latitude, longitude });
        if (!place.ok) return failure(place.error);
        const answer = await weatherNow(
          deps.client,
          place.place,
          weatherOrder(place.place, deps.allows, source),
        );
        return text(
          envelope(
            answer.sourceId,
            { place: place.place, ...answer.value },
            {
              fetchedAt: answer.fetchedAt,
              observedAt: answer.observedAt,
              cached: answer.cached,
            },
          ),
        );
      }),
  );

  register(
    "weather_forecast",
    {
      description:
        "The hourly forecast for the project's site (or coordinates you give), starting now: temperature, wind, cloud cover and precipitation by the hour (up to 168 hours, default 48). Says which source answered and when the forecast was made.",
      inputSchema: z.object({
        ...PLACE,
        hours: z.number().int().min(1).max(168).optional().describe("How many hours (default 48)"),
        source: SOURCE,
      }),
    },
    async ({ latitude, longitude, hours, source }) =>
      guarded(async () => {
        const place = placeFor(deps.site(), { latitude, longitude });
        if (!place.ok) return failure(place.error);
        const answer = await weatherForecast(
          deps.client,
          place.place,
          weatherOrder(place.place, deps.allows, source),
          hours ?? 48,
        );
        return text(
          envelope(
            answer.sourceId,
            { place: place.place, hours: answer.value },
            {
              fetchedAt: answer.fetchedAt,
              observedAt: answer.observedAt,
              cached: answer.cached,
            },
          ),
        );
      }),
  );

  register(
    "climate_normals",
    {
      description:
        "The climate normals for the project's site (or coordinates you give): monthly and annual means of air temperature (degrees C), relative humidity, wind speed at 10 m (m/s) and solar radiation on a horizontal surface (kWh per square metre per day), from NASA POWER's long-term climatology, with the years it covers. A coarse grid (about 50 km): good for design, not for a weather file.",
      inputSchema: z.object({ ...PLACE }),
    },
    async ({ latitude, longitude }) =>
      guarded(async () => {
        const place = placeFor(deps.site(), { latitude, longitude });
        if (!place.ok) return failure(place.error);
        const answer = await climateNormals(deps.client, place.place);
        return text(
          envelope(
            "nasa-power",
            { place: place.place, ...answer.value },
            {
              fetchedAt: answer.fetchedAt,
              cached: answer.cached,
            },
          ),
        );
      }),
  );
}
