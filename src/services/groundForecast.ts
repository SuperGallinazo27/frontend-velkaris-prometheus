/**
 * Humedad del suelo, lluvia y tiempo de los últimos 7 días y de los 7 siguientes en un punto,
 * desde Open-Meteo (https://open-meteo.com). Es lo que usa la aplicación para decir cómo está el
 * suelo hoy y para el pronóstico de rodadura.
 *
 * - Gratuito y sin clave para uso no comercial; datos bajo CC BY 4.0 (hay que citar a Open-Meteo).
 * - La humedad del suelo es la de un **modelo meteorológico** para una celda de varios kilómetros,
 *   en m³ de agua por m³ de suelo. No es un sensor enterrado en el lugar.
 * - Una sola consulta por lugar, que se reutiliza media hora.
 */
import { ENDPOINT } from "./weather";

/** Días hacia atrás (para la lluvia reciente) y hacia delante (hoy incluido). */
export const PAST_DAYS = 7;
export const FORECAST_DAYS = 7;

const CACHE_MS = 30 * 60 * 1000;

/** Capas de suelo que da el modelo, con su espesor en cm: juntas son los primeros 9 cm. */
const LAYERS = [
  { key: "soil_moisture_0_to_1cm", cm: 1 },
  { key: "soil_moisture_1_to_3cm", cm: 2 },
  { key: "soil_moisture_3_to_9cm", cm: 6 },
] as const;

const HOURLY = [
  ...LAYERS.map((layer) => layer.key),
  "soil_temperature_0cm",
  "snow_depth",
  "precipitation",
  "temperature_2m",
  "wind_speed_10m",
] as const;

export interface GroundHour {
  /** Hora local del lugar (`2026-11-15T07:00`). */
  time: string;
  /** m³ de agua por m³ de suelo en los primeros 9 cm; null si el modelo no la da. */
  moisture: number | null;
  /** mm en esa hora. */
  rain: number;
  /** °C en la superficie del suelo. */
  soilTemp: number | null;
  /** m de nieve. */
  snowDepth: number | null;
  /** °C del aire a 2 m. */
  temperature: number | null;
  /** km/h a 10 m. */
  wind: number | null;
}

export interface GroundDay {
  /** Fecha del lugar (`2026-11-15`). */
  date: string;
  /** Media del día de la humedad de los primeros 9 cm, m³/m³. */
  moisture: number | null;
  /** mm del día. */
  rainMm: number;
  /** mm de ese día y de los dos anteriores. */
  rain3dMm: number;
  /** mm de ese día y de los seis anteriores. */
  rain7dMm: number;
  /** °C en la superficie del suelo: la más baja y la más alta del día. */
  soilTempMin: number | null;
  soilTempMax: number | null;
  /** m de nieve, el máximo del día. */
  snowDepthMax: number | null;
  temperatureMin: number | null;
  temperatureMax: number | null;
  /** Viento medio del día, km/h. */
  windMean: number | null;
}

export interface GroundForecast {
  timezone: string;
  utcOffsetSeconds: number;
  /** La última hora ya transcurrida en el lugar. */
  now: GroundHour;
  /** mm en las 72 horas y en los 7 días anteriores a ahora. */
  rain72hMm: number;
  rain7dMm: number;
  /** Hoy y los días siguientes, en la fecha del lugar. */
  days: GroundDay[];
}

export function groundForecastUrl(latitude: number, longitude: number): string {
  const params = new URLSearchParams({
    latitude: latitude.toFixed(4),
    longitude: longitude.toFixed(4),
    hourly: HOURLY.join(","),
    past_days: String(PAST_DAYS),
    forecast_days: String(FORECAST_DAYS),
    timezone: "auto",
  });
  return `${ENDPOINT}?${params}`;
}

const finite = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

/** Media de los valores que hay, o null si no hay ninguno. */
function mean(values: (number | null)[]): number | null {
  const present = values.filter((value): value is number => value !== null);
  return present.length ? present.reduce((sum, value) => sum + value, 0) / present.length : null;
}

const least = (values: (number | null)[]) => {
  const present = values.filter((value): value is number => value !== null);
  return present.length ? Math.min(...present) : null;
};
const most = (values: (number | null)[]) => {
  const present = values.filter((value): value is number => value !== null);
  return present.length ? Math.max(...present) : null;
};

const round = (value: number | null, digits: number) =>
  value === null ? null : Math.round(value * 10 ** digits) / 10 ** digits;

/** Convierte la respuesta del servicio; lanza un error si no trae horas suficientes. */
export function parseGroundForecast(body: unknown, nowMs: number = Date.now()): GroundForecast {
  const data = body as { hourly?: Record<string, unknown>; timezone?: unknown; utc_offset_seconds?: unknown } | null;
  const hourly = data?.hourly;
  const times = Array.isArray(hourly?.time) ? (hourly.time as unknown[]) : [];
  const column = (key: string) => (Array.isArray(hourly?.[key]) ? (hourly[key] as unknown[]) : []);
  const layers = LAYERS.map((layer) => ({ cm: layer.cm, values: column(layer.key) }));
  const soilTemp = column("soil_temperature_0cm");
  const snow = column("snow_depth");
  const rain = column("precipitation");
  const temperature = column("temperature_2m");
  const wind = column("wind_speed_10m");

  const hours: GroundHour[] = [];
  times.forEach((time, i) => {
    if (typeof time !== "string") return;
    // Media de las capas que tengan dato, pesada por su espesor.
    let water = 0;
    let depth = 0;
    for (const layer of layers) {
      const value = finite(layer.values[i]);
      if (value !== null) {
        water += value * layer.cm;
        depth += layer.cm;
      }
    }
    hours.push({
      time,
      moisture: depth ? water / depth : null,
      rain: finite(rain[i]) ?? 0,
      soilTemp: finite(soilTemp[i]),
      snowDepth: finite(snow[i]),
      temperature: finite(temperature[i]),
      wind: finite(wind[i]),
    });
  });
  if (hours.length < 48) throw new Error("Respuesta sin horas suficientes");

  const utcOffsetSeconds = finite(data?.utc_offset_seconds) ?? 0;
  // La hora de ahora en el lugar, escrita como las del servicio, para compararlas como texto.
  const nowLocal = new Date(nowMs + utcOffsetSeconds * 1000).toISOString().slice(0, 16);
  let nowIndex = hours.findLastIndex((hour) => hour.time <= nowLocal);
  if (nowIndex < 0) nowIndex = 0;
  const rainBefore = (count: number) =>
    hours.slice(Math.max(0, nowIndex - count + 1), nowIndex + 1).reduce((sum, hour) => sum + hour.rain, 0);

  const byDate = new Map<string, GroundHour[]>();
  for (const hour of hours) {
    const date = hour.time.slice(0, 10);
    byDate.set(date, [...(byDate.get(date) ?? []), hour]);
  }
  const dates = [...byDate.keys()].sort();
  const rainOf = (date: string | undefined) =>
    date && byDate.has(date) ? byDate.get(date)!.reduce((sum, hour) => sum + hour.rain, 0) : 0;
  /** mm del día `index` y de los `count - 1` anteriores. */
  const rainUpTo = (index: number, count: number) => {
    let total = 0;
    for (let back = 0; back < count; back++) total += rainOf(dates[index - back]);
    return total;
  };
  const today = nowLocal.slice(0, 10);
  const days: GroundDay[] = [];
  dates.forEach((date, index) => {
    const list = byDate.get(date)!;
    // Un día a medias (el último que trae el servicio) no da una media fiable.
    if (date < today || list.length < 12) return;
    days.push({
      date,
      moisture: round(mean(list.map((hour) => hour.moisture)), 3),
      rainMm: round(rainOf(date), 1)!,
      rain3dMm: round(rainUpTo(index, 3), 1)!,
      rain7dMm: round(rainUpTo(index, 7), 1)!,
      soilTempMin: round(least(list.map((hour) => hour.soilTemp)), 1),
      soilTempMax: round(most(list.map((hour) => hour.soilTemp)), 1),
      snowDepthMax: round(most(list.map((hour) => hour.snowDepth)), 2),
      temperatureMin: round(least(list.map((hour) => hour.temperature)), 1),
      temperatureMax: round(most(list.map((hour) => hour.temperature)), 1),
      windMean: round(mean(list.map((hour) => hour.wind)), 1),
    });
  });
  if (!days.length) throw new Error("Respuesta sin el día de hoy");

  const current = hours[nowIndex];
  return {
    timezone: typeof data?.timezone === "string" ? data.timezone : "",
    utcOffsetSeconds,
    now: { ...current, moisture: round(current.moisture, 3) },
    rain72hMm: round(rainBefore(72), 1)!,
    rain7dMm: round(rainBefore(168), 1)!,
    days: days.slice(0, FORECAST_DAYS),
  };
}

const cache = new Map<string, { at: number; value: Promise<GroundForecast> }>();

export function fetchGroundForecast(
  latitude: number,
  longitude: number,
  fetcher: typeof fetch = fetch,
  now = Date.now(),
): Promise<GroundForecast> {
  const url = groundForecastUrl(latitude, longitude);
  const hit = cache.get(url);
  if (hit && now - hit.at < CACHE_MS) return hit.value;

  const value = fetcher(url).then(async (response) => {
    if (!response.ok) throw new Error(`Open-Meteo respondió ${response.status}`);
    return parseGroundForecast(await response.json(), now);
  });
  cache.set(url, { at: now, value });
  // Un fallo no se guarda: el próximo intento vuelve a consultar.
  value.catch(() => {
    if (cache.get(url)?.value === value) cache.delete(url);
  });
  return value;
}
