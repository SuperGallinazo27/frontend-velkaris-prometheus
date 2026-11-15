/**
 * Dónde está el Sol en un lugar y un instante: altura sobre el horizonte y acimut. Sirve para
 * iluminar el simulador con la luz real del sitio.
 *
 * Fórmulas de baja precisión del Almanaque Astronómico (error de centésimas de grado entre 1950
 * y 2050), más que suficientes para una luz. No tiene en cuenta la refracción ni el relieve.
 */

const RAD = Math.PI / 180;
const DAY_MS = 86_400_000;

export interface SunPosition {
  /** Grados sobre el horizonte; negativo si el Sol está debajo. */
  elevation: number;
  /** Grados desde el norte hacia el este (90 = este, 180 = sur). */
  azimuth: number;
}

const wrap = (degrees: number) => ((degrees % 360) + 360) % 360;

export function sunPosition(date: Date, latitude: number, longitude: number): SunPosition {
  // Días desde el mediodía del 1 de enero de 2000 (época J2000).
  const n = date.getTime() / DAY_MS + 2440587.5 - 2451545;
  const meanLongitude = wrap(280.46 + 0.9856474 * n);
  const anomaly = wrap(357.528 + 0.9856003 * n) * RAD;
  const ecliptic = (meanLongitude + 1.915 * Math.sin(anomaly) + 0.02 * Math.sin(2 * anomaly)) * RAD;
  const obliquity = (23.439 - 0.0000004 * n) * RAD;
  const rightAscension = Math.atan2(Math.cos(obliquity) * Math.sin(ecliptic), Math.cos(ecliptic));
  const declination = Math.asin(Math.sin(obliquity) * Math.sin(ecliptic));
  // Hora sidérea de Greenwich, en horas; con la longitud da el ángulo horario del Sol.
  const sidereal = wrap((18.697374558 + 24.06570982441908 * n) * 15 + longitude) * RAD;
  const hourAngle = sidereal - rightAscension;
  const phi = latitude * RAD;
  const elevation = Math.asin(Math.sin(phi) * Math.sin(declination) + Math.cos(phi) * Math.cos(declination) * Math.cos(hourAngle));
  const azimuth = Math.atan2(-Math.sin(hourAngle), Math.tan(declination) * Math.cos(phi) - Math.sin(phi) * Math.cos(hourAngle));
  return { elevation: elevation / RAD, azimuth: wrap(azimuth / RAD) };
}

/** Hora solar media del lugar (0 a 24): la del reloj de sol, sin husos horarios. */
export function solarHour(date: Date, longitude: number): number {
  const utc = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  return (((utc + longitude / 15) % 24) + 24) % 24;
}

/** El instante del mismo día solar en el que el reloj de sol del lugar marca `hour`. */
export function atSolarHour(date: Date, longitude: number, hour: number): Date {
  return new Date(date.getTime() + (hour - solarHour(date, longitude)) * 3_600_000);
}

/** Altura mínima del Sol para iluminar la escena con su luz real, en grados. */
export const DAYLIGHT_MIN_DEG = 6;

export type LightMode = "real" | "manana" | "mediodia" | "referencia";

export interface SceneLight extends SunPosition {
  mode: LightMode;
  /** Hora solar con la que se ilumina la escena; null con la luz de referencia. */
  hour: number | null;
}

/**
 * La luz con la que se muestra el lugar. Si allí es de día, la del Sol real. Si es de noche, la de
 * las 9:30 de la mañana de ese mismo día; si a esa hora tampoco hay Sol (invierno polar), la del
 * mediodía, y si ni así (noche polar), una luz de referencia que no corresponde a ninguna hora.
 */
export function sceneLight(date: Date, latitude: number, longitude: number): SceneLight {
  const now = sunPosition(date, latitude, longitude);
  if (now.elevation >= DAYLIGHT_MIN_DEG) return { ...now, mode: "real", hour: solarHour(date, longitude) };
  for (const [mode, hour] of [
    ["manana", 9.5],
    ["mediodia", 12],
  ] as const) {
    const position = sunPosition(atSolarHour(date, longitude, hour), latitude, longitude);
    if (position.elevation >= DAYLIGHT_MIN_DEG) return { ...position, mode, hour };
  }
  return { elevation: 28, azimuth: latitude >= 0 ? 150 : 30, mode: "referencia", hour: null };
}

/** «10:42», a partir de una hora con decimales. */
export function clock(hour: number): string {
  const minutes = Math.round(hour * 60) % 1440;
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
}
