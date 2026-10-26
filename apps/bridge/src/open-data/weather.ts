import { type OpenDataClient, OpenDataError } from "./client.ts";

/** A place, in degrees. */
export interface Place {
  lat: number;
  lon: number;
}

/** The weather at one moment, in the units agents are told: degrees C, m/s, percent, millimetres, hPa. */
export interface Weather {
  /** When the values hold (ISO 8601). */
  time: string;
  airTemperatureC: number | null;
  relativeHumidityPercent: number | null;
  windSpeedMs: number | null;
  windFromDegrees: number | null;
  cloudCoverPercent: number | null;
  /** Rain and the like in the hour (now) or in the hour before the time (forecast), mm. */
  precipitationMm: number | null;
  pressureHPa: number | null;
  summary?: string;
}

export interface WeatherAnswer<T> {
  value: T;
  /** The source that answered (an id of OPEN_DATA_SOURCES). */
  sourceId: string;
  fetchedAt: number;
  /** When the data was produced or observed (ms). */
  observedAt: number | null;
  cached: boolean;
}

const WEATHER_SOURCES = ["nws", "met-norway", "open-meteo"] as const;
export type WeatherSourceId = (typeof WEATHER_SOURCES)[number];

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
const array = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const num = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;
const round = (value: number | null, digits = 1): number | null =>
  value === null ? null : Math.round(value * 10 ** digits) / 10 ** digits;

async function json(client: OpenDataClient, source: string, kind: string, url: string, ttlMs: number) {
  const response = await client.request({
    source,
    kind,
    url,
    ttlMs,
    headers: { accept: "application/json" },
  });
  try {
    return { data: JSON.parse(response.body.toString("utf8")) as unknown, response };
  } catch {
    throw new OpenDataError("content-type", `${new URL(url).hostname} did not answer with JSON.`);
  }
}

/** Whether a place is in the United States (including Alaska and Hawaii), where the National Weather Service serves it. */
export function inUnitedStates({ lat, lon }: Place): boolean {
  const lower48 = lat >= 24.4 && lat <= 49.5 && lon >= -125 && lon <= -66.9;
  const alaska = lat >= 51 && lat <= 71.5 && lon >= -170 && lon <= -129.9;
  const hawaii = lat >= 18.8 && lat <= 22.3 && lon >= -160.3 && lon <= -154.7;
  return lower48 || alaska || hawaii;
}

/** The order sources are tried in for a place: the National Weather Service in the US, then MET Norway, then Open-Meteo. */
export function weatherOrder(
  place: Place,
  allowed: (id: string) => boolean,
  only?: string,
): WeatherSourceId[] {
  const preferred = inUnitedStates(place)
    ? (["nws", "met-norway", "open-meteo"] as const)
    : (["met-norway", "open-meteo"] as const);
  return preferred.filter((id) => allowed(id) && (!only || id === only));
}

// MET Norway ---------------------------------------------------------------------------------------------------------

const MET = "https://api.met.no/weatherapi/locationforecast/2.0/compact";

/** MET Norway wants coordinates with at most four decimals. */
const four = (x: number) => x.toFixed(4);

function metHour(entry: unknown): Weather | null {
  const e = object(entry);
  const data = object(e.data);
  const details = object(object(data.instant).details);
  const next = object(data.next_1_hours);
  if (typeof e.time !== "string") return null;
  return {
    time: e.time,
    airTemperatureC: round(num(details.air_temperature)),
    relativeHumidityPercent: round(num(details.relative_humidity), 0),
    windSpeedMs: round(num(details.wind_speed)),
    windFromDegrees: round(num(details.wind_from_direction), 0),
    cloudCoverPercent: round(num(details.cloud_area_fraction), 0),
    precipitationMm: round(num(object(next.details).precipitation_amount)),
    pressureHPa: round(num(details.air_pressure_at_sea_level)),
    ...(typeof object(next.summary).symbol_code === "string"
      ? { summary: String(object(next.summary).symbol_code).replace(/_/g, " ") }
      : {}),
  };
}

async function metSeries(client: OpenDataClient, place: Place, ttlMs: number) {
  const url = `${MET}?lat=${four(place.lat)}&lon=${four(place.lon)}`;
  const { data, response } = await json(client, "met-norway", "weather", url, ttlMs);
  const properties = object(object(data).properties);
  const updated =
    typeof object(properties.meta).updated_at === "string"
      ? Date.parse(object(properties.meta).updated_at as string)
      : Number.NaN;
  return {
    hours: array(properties.timeseries).flatMap((t) => {
      const h = metHour(t);
      return h ? [h] : [];
    }),
    observedAt: Number.isFinite(updated) ? updated : null,
    response,
  };
}

// Open-Meteo ---------------------------------------------------------------------------------------------------------

const OPEN_METEO = "https://api.open-meteo.com/v1/forecast";

async function openMeteoSeries(client: OpenDataClient, place: Place, ttlMs: number, days: number) {
  const url =
    `${OPEN_METEO}?latitude=${four(place.lat)}&longitude=${four(place.lon)}` +
    "&current=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,cloud_cover,precipitation,pressure_msl" +
    "&hourly=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,cloud_cover,precipitation,pressure_msl" +
    `&wind_speed_unit=ms&timezone=GMT&forecast_days=${days}`;
  const { data, response } = await json(client, "open-meteo", "weather", url, ttlMs);
  const body = object(data);
  const current = object(body.current);
  // With `timezone=GMT` the times have no zone and no seconds ("2026-10-25T10:15").
  const at = (raw: unknown) => (typeof raw === "string" ? (raw.endsWith("Z") ? raw : `${raw}:00Z`) : null);
  const now: Weather | null =
    typeof current.time === "string"
      ? {
          time: at(current.time) as string,
          airTemperatureC: round(num(current.temperature_2m)),
          relativeHumidityPercent: round(num(current.relative_humidity_2m), 0),
          windSpeedMs: round(num(current.wind_speed_10m)),
          windFromDegrees: round(num(current.wind_direction_10m), 0),
          cloudCoverPercent: round(num(current.cloud_cover), 0),
          precipitationMm: round(num(current.precipitation)),
          pressureHPa: round(num(current.pressure_msl)),
        }
      : null;
  const hourly = object(body.hourly);
  const times = array(hourly.time);
  const series = (name: string) => array(hourly[name]);
  const hours: Weather[] = times.flatMap((t, i) =>
    typeof t === "string"
      ? [
          {
            time: at(t) as string,
            airTemperatureC: round(num(series("temperature_2m")[i])),
            relativeHumidityPercent: round(num(series("relative_humidity_2m")[i]), 0),
            windSpeedMs: round(num(series("wind_speed_10m")[i])),
            windFromDegrees: round(num(series("wind_direction_10m")[i]), 0),
            cloudCoverPercent: round(num(series("cloud_cover")[i]), 0),
            precipitationMm: round(num(series("precipitation")[i])),
            pressureHPa: round(num(series("pressure_msl")[i])),
          },
        ]
      : [],
  );
  return { now, hours, response };
}

// US National Weather Service ----------------------------------------------------------------------------------------

const NWS = "https://api.weather.gov";

const kmhToMs = (v: number | null) => (v === null ? null : v / 3.6);

async function nwsPoint(client: OpenDataClient, place: Place) {
  const url = `${NWS}/points/${place.lat.toFixed(4)},${place.lon.toFixed(4)}`;
  const { data } = await json(client, "nws", "weather", url, 24 * 3600_000);
  const p = object(object(data).properties);
  return {
    stations: typeof p.observationStations === "string" ? p.observationStations : null,
    hourly: typeof p.forecastHourly === "string" ? p.forecastHourly : null,
  };
}

async function nwsNow(client: OpenDataClient, place: Place, ttlMs: number) {
  const point = await nwsPoint(client, place);
  if (!point.stations)
    throw new OpenDataError("http", "The National Weather Service has no stations for that place.");
  const list = await json(client, "nws", "weather", point.stations, 24 * 3600_000);
  const station = array(object(list.data).features)
    .map((f) => object(object(f).properties).stationIdentifier)
    .find((id): id is string => typeof id === "string");
  if (!station)
    throw new OpenDataError("http", "The National Weather Service lists no station near that place.");
  const { data, response } = await json(
    client,
    "nws",
    "weather",
    `${NWS}/stations/${station}/observations/latest`,
    ttlMs,
  );
  const p = object(object(data).properties);
  const value = (name: string) => num(object(p[name]).value);
  if (typeof p.timestamp !== "string")
    throw new OpenDataError("http", `Station ${station} has no observation.`);
  const weather: Weather = {
    time: p.timestamp,
    airTemperatureC: round(value("temperature")),
    relativeHumidityPercent: round(value("relativeHumidity"), 0),
    windSpeedMs: round(kmhToMs(value("windSpeed"))),
    windFromDegrees: round(value("windDirection"), 0),
    cloudCoverPercent: null,
    precipitationMm: round(value("precipitationLastHour")),
    pressureHPa: round(
      value("barometricPressure") === null ? null : (value("barometricPressure") as number) / 100,
    ),
    ...(typeof p.textDescription === "string" && p.textDescription ? { summary: p.textDescription } : {}),
  };
  return { weather, station, response, observedAt: Date.parse(p.timestamp) };
}

async function nwsHours(client: OpenDataClient, place: Place, ttlMs: number) {
  const point = await nwsPoint(client, place);
  if (!point.hourly)
    throw new OpenDataError("http", "The National Weather Service has no forecast for that place.");
  const { data, response } = await json(client, "nws", "weather", `${point.hourly}?units=si`, ttlMs);
  const p = object(object(data).properties);
  const hours: Weather[] = array(p.periods).flatMap((raw) => {
    const period = object(raw);
    if (typeof period.startTime !== "string") return [];
    const wind = /([\d.]+)/.exec(typeof period.windSpeed === "string" ? period.windSpeed : "");
    return [
      {
        time: period.startTime,
        airTemperatureC: round(num(period.temperature)),
        relativeHumidityPercent: round(num(object(period.relativeHumidity).value), 0),
        windSpeedMs: wind ? round(kmhToMs(Number(wind[1]))) : null,
        windFromDegrees: null,
        cloudCoverPercent: null,
        precipitationMm: null,
        pressureHPa: null,
        ...(typeof period.shortForecast === "string" ? { summary: period.shortForecast } : {}),
      },
    ];
  });
  const generated = typeof p.generatedAt === "string" ? Date.parse(p.generatedAt) : Number.NaN;
  return { hours, observedAt: Number.isFinite(generated) ? generated : null, response };
}

// What the tools call ------------------------------------------------------------------------------------------------

const NOW_TTL_MS = 10 * 60_000;
/** MET Norway asks not to repeat a request before its Expires time, which it sets about 30 minutes ahead. */
const MET_TTL_MS = 30 * 60_000;
const FORECAST_TTL_MS = 3600_000;

/** Tries the sources in order and returns the first that answers; when all fail, the last error says why. */
async function firstOf<T>(order: WeatherSourceId[], run: (id: WeatherSourceId) => Promise<T>): Promise<T> {
  if (order.length === 0)
    throw new OpenDataError(
      "off",
      "No weather source is on for that place. Sources are listed in Settings > Open data (Open-Meteo needs the user's acknowledgement).",
    );
  let last: unknown = null;
  for (const id of order) {
    try {
      return await run(id);
    } catch (error) {
      last = error;
      if (
        error instanceof OpenDataError &&
        ["off", "host-not-allowed", "private-address"].includes(error.code) &&
        order.length === 1
      )
        throw error;
    }
  }
  throw last instanceof Error ? last : new OpenDataError("http", "No weather source answered.");
}

/** The weather now at a place: the observation (US) or the model's latest hour, from the first source that answers. */
export async function weatherNow(
  client: OpenDataClient,
  place: Place,
  order: WeatherSourceId[],
): Promise<WeatherAnswer<Weather>> {
  return firstOf(order, async (id) => {
    if (id === "nws") {
      const r = await nwsNow(client, place, NOW_TTL_MS);
      return {
        value: { ...r.weather },
        sourceId: id,
        fetchedAt: r.response.fetchedAt,
        observedAt: r.observedAt,
        cached: r.response.cached,
      };
    }
    if (id === "met-norway") {
      const r = await metSeries(client, place, MET_TTL_MS);
      const first = r.hours[0];
      if (!first) throw new OpenDataError("http", "MET Norway returned no hours.");
      return {
        value: first,
        sourceId: id,
        fetchedAt: r.response.fetchedAt,
        observedAt: r.observedAt ?? Date.parse(first.time),
        cached: r.response.cached,
      };
    }
    const r = await openMeteoSeries(client, place, NOW_TTL_MS, 1);
    if (!r.now) throw new OpenDataError("http", "Open-Meteo returned no current weather.");
    return {
      value: r.now,
      sourceId: id,
      fetchedAt: r.response.fetchedAt,
      observedAt: Date.parse(r.now.time),
      cached: r.response.cached,
    };
  });
}

/** The hourly forecast, at most `hours` (up to 168), starting now. */
export async function weatherForecast(
  client: OpenDataClient,
  place: Place,
  order: WeatherSourceId[],
  hours: number,
  now = Date.now(),
): Promise<WeatherAnswer<Weather[]>> {
  return firstOf(order, async (id) => {
    const pick = (all: Weather[]) =>
      all.filter((h) => Date.parse(h.time) >= now - 3600_000).slice(0, Math.min(168, Math.max(1, hours)));
    if (id === "nws") {
      const r = await nwsHours(client, place, FORECAST_TTL_MS);
      return {
        value: pick(r.hours),
        sourceId: id,
        fetchedAt: r.response.fetchedAt,
        observedAt: r.observedAt,
        cached: r.response.cached,
      };
    }
    if (id === "met-norway") {
      const r = await metSeries(client, place, FORECAST_TTL_MS);
      return {
        value: pick(r.hours),
        sourceId: id,
        fetchedAt: r.response.fetchedAt,
        observedAt: r.observedAt,
        cached: r.response.cached,
      };
    }
    const r = await openMeteoSeries(client, place, FORECAST_TTL_MS, Math.min(7, Math.ceil(hours / 24) + 1));
    return {
      value: pick(r.hours),
      sourceId: id,
      fetchedAt: r.response.fetchedAt,
      observedAt: r.hours[0] ? Date.parse(r.hours[0].time) : null,
      cached: r.response.cached,
    };
  });
}

// NASA POWER climate normals -----------------------------------------------------------------------------------------

const POWER = "https://power.larc.nasa.gov/api/temporal/climatology/point";
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"] as const;

export interface MonthlyNormals {
  month: string;
  airTemperatureC: number | null;
  relativeHumidityPercent: number | null;
  windSpeedMs: number | null;
  /** Solar radiation on a horizontal surface under all sky conditions, kWh per square metre per day. */
  solarKWhPerM2Day: number | null;
}

export interface Normals {
  months: MonthlyNormals[];
  annual: Omit<MonthlyNormals, "month">;
  /** The years the normals are made from, when the service says. */
  period: string;
}

/** The normals of a place from NASA POWER's climatology (long-term monthly means). */
export async function climateNormals(
  client: OpenDataClient,
  place: Place,
): Promise<{ value: Normals; fetchedAt: number; cached: boolean }> {
  const url =
    `${POWER}?parameters=T2M,RH2M,WS10M,ALLSKY_SFC_SW_DWN&community=RE` +
    `&longitude=${place.lon.toFixed(4)}&latitude=${place.lat.toFixed(4)}&format=JSON`;
  const { data, response } = await json(client, "nasa-power", "climate normals", url, 30 * 24 * 3600_000);
  const body = object(data);
  const parameter = object(object(body.properties).parameter);
  const fill = num(object(body.header).fill_value) ?? -999;
  const cell = (name: string, key: string): number | null => {
    const v = num(object(parameter[name])[key]);
    return v === null || v === fill ? null : round(v, 2);
  };
  if (Object.keys(parameter).length === 0)
    throw new OpenDataError("http", "NASA POWER returned no climatology for that place.");
  const header = object(body.header);
  const start = num(header.start);
  const end = num(header.end);
  return {
    value: {
      months: MONTHS.map((m, i) => ({
        month: `${String(i + 1).padStart(2, "0")} ${m[0]}${m.slice(1).toLowerCase()}`,
        airTemperatureC: cell("T2M", m),
        relativeHumidityPercent: cell("RH2M", m),
        windSpeedMs: cell("WS10M", m),
        solarKWhPerM2Day: cell("ALLSKY_SFC_SW_DWN", m),
      })),
      annual: {
        airTemperatureC: cell("T2M", "ANN"),
        relativeHumidityPercent: cell("RH2M", "ANN"),
        windSpeedMs: cell("WS10M", "ANN"),
        solarKWhPerM2Day: cell("ALLSKY_SFC_SW_DWN", "ANN"),
      },
      period:
        start !== null && end !== null
          ? `${start}-${end}`
          : "the long-term climatology of the service (about thirty years)",
    },
    fetchedAt: response.fetchedAt,
    cached: response.cached,
  };
}
