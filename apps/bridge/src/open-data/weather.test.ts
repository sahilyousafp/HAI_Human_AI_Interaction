import { describe, expect, it } from "vitest";
import { OpenDataClient, type RawResponse, type Transport } from "./client.ts";
import { OpenDataRecord } from "./record.ts";
import { sourceHosts } from "./sources.ts";
import { climateNormals, inUnitedStates, weatherForecast, weatherNow, weatherOrder } from "./weather.ts";

const NOW = Date.parse("2026-10-25T10:20:00Z");
const amsterdam = { lat: 52.37, lon: 4.9 };
const denver = { lat: 39.74, lon: -104.99 };

const json = (value: unknown, status = 200): RawResponse => ({
  status,
  headers: { "content-type": "application/json" },
  body: Buffer.from(JSON.stringify(value)),
});

const metBody = {
  type: "Feature",
  properties: {
    meta: { updated_at: "2026-10-25T10:00:00Z" },
    timeseries: [
      {
        time: "2026-10-25T10:00:00Z",
        data: {
          instant: {
            details: {
              air_temperature: 11.46,
              relative_humidity: 82.3,
              wind_speed: 4.24,
              wind_from_direction: 231.4,
              cloud_area_fraction: 75,
              air_pressure_at_sea_level: 1012.8,
            },
          },
          next_1_hours: {
            summary: { symbol_code: "partlycloudy_day" },
            details: { precipitation_amount: 0.2 },
          },
        },
      },
      {
        time: "2026-10-25T11:00:00Z",
        data: {
          instant: { details: { air_temperature: 12.1 } },
          next_1_hours: { details: { precipitation_amount: 0 } },
        },
      },
      { time: "2026-10-25T12:00:00Z", data: { instant: { details: { air_temperature: 13 } } } },
      { time: "2026-10-25T13:00:00Z", data: { instant: { details: { air_temperature: 13.4 } } } },
    ],
  },
};

const openMeteoBody = {
  current: {
    time: "2026-10-25T10:15",
    temperature_2m: 10.9,
    relative_humidity_2m: 80,
    wind_speed_10m: 3.9,
    wind_direction_10m: 240,
    cloud_cover: 70,
    precipitation: 0,
    pressure_msl: 1013.2,
  },
  hourly: {
    time: ["2026-10-25T09:00", "2026-10-25T10:00", "2026-10-25T11:00", "2026-10-25T12:00"],
    temperature_2m: [10.1, 10.8, 11.5, 12.2],
    relative_humidity_2m: [85, 82, 79, 75],
    wind_speed_10m: [3.5, 3.8, 4, 4.2],
    wind_direction_10m: [240, 240, 245, 250],
    cloud_cover: [80, 70, 60, 50],
    precipitation: [0, 0, 0.1, 0],
    pressure_msl: [1013, 1013, 1012, 1012],
  },
};

const nwsPoint = {
  properties: {
    observationStations: "https://api.weather.gov/gridpoints/BOU/62,60/stations",
    forecastHourly: "https://api.weather.gov/gridpoints/BOU/62,60/forecast/hourly",
  },
};
const nwsStations = { features: [{ properties: { stationIdentifier: "KDEN" } }] };
const nwsObservation = {
  properties: {
    timestamp: "2026-10-25T10:00:00+00:00",
    textDescription: "Mostly Cloudy",
    temperature: { value: 7.2 },
    relativeHumidity: { value: 54.6 },
    windSpeed: { value: 18 },
    windDirection: { value: 300 },
    barometricPressure: { value: 101900 },
    precipitationLastHour: { value: null },
  },
};
const nwsHourly = {
  properties: {
    generatedAt: "2026-10-25T09:40:00+00:00",
    periods: [
      {
        startTime: "2026-10-25T10:00:00+00:00",
        temperature: 7,
        windSpeed: "18 km/h",
        relativeHumidity: { value: 55 },
        shortForecast: "Mostly Cloudy",
      },
      {
        startTime: "2026-10-25T11:00:00+00:00",
        temperature: 8,
        windSpeed: "12 km/h",
        relativeHumidity: { value: 50 },
        shortForecast: "Sunny",
      },
    ],
  },
};

const power = {
  header: { fill_value: -999, start: 1991, end: 2020 },
  properties: {
    parameter: {
      T2M: {
        JAN: 3.1,
        FEB: 3.4,
        MAR: 6.2,
        APR: 9.1,
        MAY: 12.9,
        JUN: 15.6,
        JUL: 17.9,
        AUG: 17.7,
        SEP: 14.8,
        OCT: 11,
        NOV: 6.9,
        DEC: 4,
        ANN: 10.2,
      },
      RH2M: {
        JAN: 87,
        FEB: 84,
        MAR: 80,
        APR: 74,
        MAY: 72,
        JUN: 74,
        JUL: 75,
        AUG: 77,
        SEP: 81,
        OCT: 85,
        NOV: 88,
        DEC: 89,
        ANN: 80.5,
      },
      WS10M: {
        JAN: 5.6,
        FEB: 5.5,
        MAR: 5.4,
        APR: 5,
        MAY: 4.7,
        JUN: 4.4,
        JUL: 4.3,
        AUG: 4.3,
        SEP: 4.6,
        OCT: 5.1,
        NOV: 5.4,
        DEC: 5.6,
        ANN: 5,
      },
      ALLSKY_SFC_SW_DWN: {
        JAN: 0.6,
        FEB: 1.3,
        MAR: 2.5,
        APR: 3.9,
        MAY: 5,
        JUN: 5.4,
        JUL: 5.2,
        AUG: 4.4,
        SEP: 3.1,
        OCT: 1.7,
        NOV: 0.8,
        DEC: -999,
        ANN: 3,
      },
    },
  },
};

function setup(allowed: (id: string) => boolean = () => true, failing: string[] = []) {
  const calls: string[] = [];
  const transport: Transport = async (url) => {
    calls.push(url.href);
    if (failing.includes(url.hostname)) return json({}, 500);
    if (url.hostname === "api.met.no") return json(metBody);
    if (url.hostname === "api.open-meteo.com") return json(openMeteoBody);
    if (url.hostname === "power.larc.nasa.gov") return json(power);
    if (url.hostname === "api.weather.gov") {
      if (url.pathname.startsWith("/points/")) return json(nwsPoint);
      if (url.pathname.endsWith("/stations")) return json(nwsStations);
      if (url.pathname.endsWith("/observations/latest")) return json(nwsObservation);
      if (url.pathname.endsWith("/forecast/hourly")) return json(nwsHourly);
    }
    return json({}, 404);
  };
  const client = new OpenDataClient({
    allows: allowed,
    hosts: (id) => sourceHosts(id, []),
    cacheDir: () => null,
    userAgent: "HAI/test",
    record: new OpenDataRecord(),
    transport,
    sleep: async () => {},
    gapMs: 0,
    now: () => NOW,
  });
  return { client, calls };
}

describe("which source answers for a place", () => {
  const all = () => true;
  it("the National Weather Service first in the United States, then MET Norway, then Open-Meteo", () => {
    expect(inUnitedStates(denver)).toBe(true);
    expect(inUnitedStates({ lat: 61.2, lon: -149.9 })).toBe(true); // Anchorage
    expect(inUnitedStates({ lat: 21.3, lon: -157.8 })).toBe(true); // Honolulu
    expect(inUnitedStates(amsterdam)).toBe(false);
    expect(weatherOrder(denver, all)).toEqual(["nws", "met-norway", "open-meteo"]);
    expect(weatherOrder(amsterdam, all)).toEqual(["met-norway", "open-meteo"]);
  });

  it("leaves out a source that is off (Open-Meteo until acknowledged) and can be told to use one", () => {
    expect(weatherOrder(amsterdam, (id) => id !== "open-meteo")).toEqual(["met-norway"]);
    expect(weatherOrder(denver, all, "open-meteo")).toEqual(["open-meteo"]);
    expect(weatherOrder(amsterdam, () => false)).toEqual([]);
  });
});

describe("the weather now", () => {
  it("MET Norway: the model's latest hour, with the time it was produced as the observation time", async () => {
    const t = setup();
    const r = await weatherNow(t.client, amsterdam, ["met-norway"]);
    expect(t.calls[0]).toBe(
      "https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=52.3700&lon=4.9000",
    );
    expect(r.sourceId).toBe("met-norway");
    expect(r.value).toMatchObject({
      time: "2026-10-25T10:00:00Z",
      airTemperatureC: 11.5,
      relativeHumidityPercent: 82,
      windSpeedMs: 4.2,
      windFromDegrees: 231,
      cloudCoverPercent: 75,
      precipitationMm: 0.2,
      pressureHPa: 1012.8,
      summary: "partlycloudy day",
    });
    expect(r.observedAt).toBe(Date.parse("2026-10-25T10:00:00Z"));
  });

  it("Open-Meteo: the current values, in metres a second", async () => {
    const t = setup();
    const r = await weatherNow(t.client, amsterdam, ["open-meteo"]);
    expect(t.calls[0]).toContain("wind_speed_unit=ms");
    expect(r.value).toMatchObject({
      time: "2026-10-25T10:15:00Z",
      airTemperatureC: 10.9,
      windSpeedMs: 3.9,
      cloudCoverPercent: 70,
    });
  });

  it("the National Weather Service: the latest observation of the nearest station, wind converted from km/h", async () => {
    const t = setup();
    const r = await weatherNow(t.client, denver, ["nws"]);
    expect(t.calls).toEqual([
      "https://api.weather.gov/points/39.7400,-104.9900",
      "https://api.weather.gov/gridpoints/BOU/62,60/stations",
      "https://api.weather.gov/stations/KDEN/observations/latest",
    ]);
    expect(r.value).toMatchObject({
      airTemperatureC: 7.2,
      relativeHumidityPercent: 55,
      windSpeedMs: 5,
      windFromDegrees: 300,
      pressureHPa: 1019,
      summary: "Mostly Cloudy",
    });
    expect(r.observedAt).toBe(Date.parse("2026-10-25T10:00:00Z"));
  });

  it("goes on to the next source when one fails", async () => {
    const t = setup(() => true, ["api.met.no"]);
    const r = await weatherNow(t.client, amsterdam, ["met-norway", "open-meteo"]);
    expect(r.sourceId).toBe("open-meteo");
  });

  it("says why when every source fails, and that none is on when the order is empty", async () => {
    const t = setup(() => true, ["api.met.no", "api.open-meteo.com"]);
    await expect(weatherNow(t.client, amsterdam, ["met-norway", "open-meteo"])).rejects.toMatchObject({
      code: "http",
    });
    await expect(weatherNow(t.client, amsterdam, [])).rejects.toThrow(/No weather source is on/);
  });
});

describe("the forecast", () => {
  it("starts at the hour now falls in and gives at most the hours asked for", async () => {
    const t = setup();
    const r = await weatherForecast(t.client, amsterdam, ["met-norway"], 2, NOW);
    expect(r.value.map((h) => h.time)).toEqual(["2026-10-25T10:00:00Z", "2026-10-25T11:00:00Z"]);
    expect(r.value[1]?.airTemperatureC).toBe(12.1);
  });

  it("Open-Meteo hours, and the National Weather Service's, in the same shape", async () => {
    const t = setup();
    const om = await weatherForecast(t.client, amsterdam, ["open-meteo"], 10, NOW);
    expect(om.value.map((h) => h.airTemperatureC)).toEqual([10.8, 11.5, 12.2]);
    const nws = await weatherForecast(t.client, denver, ["nws"], 10, NOW);
    expect(t.calls.some((c) => c.endsWith("/forecast/hourly?units=si"))).toBe(true);
    expect(nws.value[0]).toMatchObject({
      airTemperatureC: 7,
      windSpeedMs: 5,
      relativeHumidityPercent: 55,
      summary: "Mostly Cloudy",
    });
  });
});

describe("climate normals", () => {
  it("monthly means and the annual mean from NASA POWER, with the period, and the fill value as no value", async () => {
    const t = setup();
    const { value } = await climateNormals(t.client, amsterdam);
    expect(t.calls[0]).toContain(
      "power.larc.nasa.gov/api/temporal/climatology/point?parameters=T2M,RH2M,WS10M,ALLSKY_SFC_SW_DWN",
    );
    expect(t.calls[0]).toContain("longitude=4.9000&latitude=52.3700");
    expect(value.months).toHaveLength(12);
    expect(value.months[6]).toMatchObject({
      month: "07 Jul",
      airTemperatureC: 17.9,
      solarKWhPerM2Day: 5.2,
      windSpeedMs: 4.3,
    });
    expect(value.months[11]?.solarKWhPerM2Day).toBeNull();
    expect(value.annual).toMatchObject({ airTemperatureC: 10.2, solarKWhPerM2Day: 3 });
    expect(value.period).toBe("1991-2020");
  });

  it("says when the service has nothing for the place", async () => {
    const empty = new OpenDataClient({
      allows: () => true,
      hosts: (id) => sourceHosts(id, []),
      cacheDir: () => null,
      userAgent: "HAI/test",
      record: new OpenDataRecord(),
      transport: async () => json({ properties: { parameter: {} } }),
      sleep: async () => {},
    });
    await expect(climateNormals(empty, amsterdam)).rejects.toThrow(/no climatology/);
  });
});
