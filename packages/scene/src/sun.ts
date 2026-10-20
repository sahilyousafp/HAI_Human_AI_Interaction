/**
 * The sun's position for a moment and a place, by NOAA's solar position algorithm (the one behind the NOAA Solar
 * Calculator and its spreadsheets, after Meeus, "Astronomical Algorithms"). Accurate to about a minute of time
 * and a fraction of a degree for dates within a few centuries of 2000, which is far more than shadow studies need.
 */

const RAD = Math.PI / 180;
const sin = (deg: number) => Math.sin(deg * RAD);
const cos = (deg: number) => Math.cos(deg * RAD);
const tan = (deg: number) => Math.tan(deg * RAD);
const deg = (rad: number) => rad / RAD;
const mod = (value: number, by: number) => ((value % by) + by) % by;

export interface SunPosition {
  /** Degrees above the horizon, corrected for atmospheric refraction; negative below it. */
  altitude: number;
  /** Degrees clockwise from north (90 is east, 180 south). */
  azimuth: number;
  /** The sun's declination, degrees. */
  declination: number;
  /** Apparent minus mean solar time, minutes. */
  equationOfTime: number;
}

/** Julian day of an instant. */
export function julianDay(date: Date): number {
  return date.getTime() / 86_400_000 + 2_440_587.5;
}

/** Atmospheric refraction, degrees, for an elevation in degrees (NOAA's approximation). */
function refraction(elevation: number): number {
  if (elevation > 85) return 0;
  const t = tan(elevation);
  let arcSeconds: number;
  if (elevation > 5) arcSeconds = 58.1 / t - 0.07 / t ** 3 + 0.000086 / t ** 5;
  else if (elevation > -0.575)
    arcSeconds = 1735 + elevation * (-518.2 + elevation * (103.4 + elevation * (-12.79 + elevation * 0.711)));
  else arcSeconds = -20.772 / t;
  return arcSeconds / 3600;
}

/**
 * Where the sun is at an instant, seen from a latitude and longitude (degrees, north and east positive).
 */
export function sunPosition(date: Date, latitude: number, longitude: number): SunPosition {
  const century = (julianDay(date) - 2_451_545) / 36_525;
  const meanLongitude = mod(280.46646 + century * (36_000.76983 + century * 0.0003032), 360);
  const meanAnomaly = 357.52911 + century * (35_999.05029 - 0.0001537 * century);
  const eccentricity = 0.016708634 - century * (0.000042037 + 0.0000001267 * century);
  const centre =
    sin(meanAnomaly) * (1.914602 - century * (0.004817 + 0.000014 * century)) +
    sin(2 * meanAnomaly) * (0.019993 - 0.000101 * century) +
    sin(3 * meanAnomaly) * 0.000289;
  const trueLongitude = meanLongitude + centre;
  const omega = 125.04 - 1934.136 * century;
  const apparentLongitude = trueLongitude - 0.00569 - 0.00478 * sin(omega);
  const meanObliquity =
    23 + (26 + (21.448 - century * (46.815 + century * (0.00059 - century * 0.001813))) / 60) / 60;
  const obliquity = meanObliquity + 0.00256 * cos(omega);
  const declination = deg(Math.asin(sin(obliquity) * sin(apparentLongitude)));

  const y = tan(obliquity / 2) ** 2;
  const equationOfTime =
    4 *
    deg(
      y * sin(2 * meanLongitude) -
        2 * eccentricity * sin(meanAnomaly) +
        4 * eccentricity * y * sin(meanAnomaly) * cos(2 * meanLongitude) -
        0.5 * y * y * sin(4 * meanLongitude) -
        1.25 * eccentricity * eccentricity * sin(2 * meanAnomaly),
    );

  const minutesUtc = mod(date.getTime() / 60_000, 1440);
  const trueSolarTime = mod(minutesUtc + equationOfTime + 4 * longitude, 1440);
  const hourAngle = trueSolarTime / 4 - 180;

  const cosZenith = Math.min(
    1,
    Math.max(-1, sin(latitude) * sin(declination) + cos(latitude) * cos(declination) * cos(hourAngle)),
  );
  const zenith = deg(Math.acos(cosZenith));
  const elevation = 90 - zenith;

  const denominator = cos(latitude) * sin(zenith);
  let azimuth: number;
  if (Math.abs(denominator) < 1e-9) {
    // At a pole or with the sun overhead the azimuth is undefined: face the sun's side.
    azimuth = latitude > 0 ? 180 : 0;
  } else {
    const cosAzimuth = Math.min(
      1,
      Math.max(-1, (sin(latitude) * cosZenith - sin(declination)) / denominator),
    );
    const angle = deg(Math.acos(cosAzimuth));
    azimuth = hourAngle > 0 ? mod(angle + 180, 360) : mod(540 - angle, 360);
  }

  return { altitude: elevation + refraction(elevation), azimuth, declination, equationOfTime };
}

/**
 * The direction light travels from the sun, in scene axes (X east, Y north, Z up, as in Rhino), as a unit vector
 * pointing from the sun towards the scene.
 */
export function sunLightDirection(
  position: Pick<SunPosition, "altitude" | "azimuth">,
): [number, number, number] {
  const { altitude, azimuth } = position;
  // Towards the sun: east is sin(azimuth), north cos(azimuth), up sin(altitude).
  const toSun: [number, number, number] = [
    cos(altitude) * sin(azimuth),
    cos(altitude) * cos(azimuth),
    sin(altitude),
  ];
  return [-toSun[0], -toSun[1], -toSun[2]];
}
