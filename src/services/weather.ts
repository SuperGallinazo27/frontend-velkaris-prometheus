/**
 * Clima actual de un punto, desde Open-Meteo (https://open-meteo.com).
 *
 * - Gratuito y sin clave para uso no comercial (hasta 10 000 consultas al día por IP).
 * - Los datos se publican bajo CC BY 4.0: hay que citar a Open-Meteo donde se muestren.
 * - Para uso comercial hace falta un plan de pago; solo cambia `ENDPOINT` y se añade `apikey`.
 */

export const ENDPOINT = "https://api.open-meteo.com/v1/forecast";

/** Cuánto se reutiliza una consulta antes de pedirla de nuevo. El modelo se actualiza cada 15 minutos. */
const CACHE_MS = 10 * 60 * 1000;

const VARIABLES = [
  "temperature_2m",
  "apparent_temperature",
  "relative_humidity_2m",
  "precipitation",
  "weather_code",
  "cloud_cover",
  "surface_pressure",
  "wind_speed_10m",
  "wind_direction_10m",
  "is_day",
] as const;

export interface CurrentWeather {
  /**
   * Hora local del lugar a la que corresponde el dato, tal como la entrega el servicio
   * (`2026-11-14T17:15`). No es la hora exacta de ahora: el modelo avanza en pasos de
   * `intervalSeconds` y esta es la de su último paso.
   */
  time: string;
  /** Zona horaria del lugar (`Pacific/Galapagos`), no la de quien mira. */
  timezone: string;
  /** Segundos que la zona del lugar se aparta de UTC (Galápagos: −21 600). */
  utcOffsetSeconds?: number;
  /** Cada cuánto calcula el modelo un valor nuevo, en segundos (900 = un cuarto de hora). */
  intervalSeconds?: number;
  /** Altitud del punto del modelo, en metros. */
  elevation: number;
  temperature: number;
  apparentTemperature: number;
  humidity: number;
  precipitation: number;
  cloudCover: number;
  pressure: number;
  windSpeed: number;
  windDirection: number;
  isDay: boolean;
  code: number;
  description: string;
}

/** Códigos WMO de estado del tiempo que usa Open-Meteo. */
const WMO: Record<number, string> = {
  0: "Despejado",
  1: "Mayormente despejado",
  2: "Parcialmente nublado",
  3: "Cubierto",
  45: "Niebla",
  48: "Niebla con escarcha",
  51: "Llovizna ligera",
  53: "Llovizna",
  55: "Llovizna intensa",
  56: "Llovizna helada ligera",
  57: "Llovizna helada",
  61: "Lluvia ligera",
  63: "Lluvia",
  65: "Lluvia intensa",
  66: "Lluvia helada ligera",
  67: "Lluvia helada",
  71: "Nevada ligera",
  73: "Nevada",
  75: "Nevada intensa",
  77: "Granos de nieve",
  80: "Chubascos ligeros",
  81: "Chubascos",
  82: "Chubascos fuertes",
  85: "Chubascos de nieve",
  86: "Chubascos de nieve fuertes",
  95: "Tormenta",
  96: "Tormenta con granizo",
  99: "Tormenta con granizo fuerte",
};

export const describeWeatherCode = (code: number) => WMO[code] ?? "Estado desconocido";

const COMPASS = ["N", "NE", "E", "SE", "S", "SO", "O", "NO"];

/** Punto cardinal desde el que sopla el viento. */
export const compassOf = (degrees: number) => COMPASS[Math.round((((degrees % 360) + 360) % 360) / 45) % 8];

export function weatherUrl(latitude: number, longitude: number): string {
  const params = new URLSearchParams({
    latitude: latitude.toFixed(4),
    longitude: longitude.toFixed(4),
    current: VARIABLES.join(","),
    timezone: "auto",
  });
  return `${ENDPOINT}?${params}`;
}

/** Convierte la respuesta del servicio; lanza un error si falta algún dato. */
export function parseWeather(body: unknown): CurrentWeather {
  const data = body as {
    current?: Record<string, unknown>;
    timezone?: unknown;
    elevation?: unknown;
    utc_offset_seconds?: unknown;
  };
  const current = data?.current;
  const number = (key: string) => {
    const value = current?.[key];
    if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`Respuesta sin ${key}`);
    return value;
  };
  const code = number("weather_code");
  return {
    time: typeof current?.time === "string" ? current.time : "",
    timezone: typeof data.timezone === "string" ? data.timezone : "",
    utcOffsetSeconds: typeof data.utc_offset_seconds === "number" ? data.utc_offset_seconds : undefined,
    intervalSeconds: typeof current?.interval === "number" ? current.interval : undefined,
    elevation: typeof data.elevation === "number" ? data.elevation : Number.NaN,
    temperature: number("temperature_2m"),
    apparentTemperature: number("apparent_temperature"),
    humidity: number("relative_humidity_2m"),
    precipitation: number("precipitation"),
    cloudCover: number("cloud_cover"),
    pressure: number("surface_pressure"),
    windSpeed: number("wind_speed_10m"),
    windDirection: number("wind_direction_10m"),
    isDay: number("is_day") === 1,
    code,
    description: describeWeatherCode(code),
  };
}

const cache = new Map<string, { at: number; value: Promise<CurrentWeather> }>();

export function fetchCurrentWeather(
  latitude: number,
  longitude: number,
  fetcher: typeof fetch = fetch,
  now = Date.now(),
): Promise<CurrentWeather> {
  const url = weatherUrl(latitude, longitude);
  const hit = cache.get(url);
  if (hit && now - hit.at < CACHE_MS) return hit.value;

  const value = fetcher(url).then(async (response) => {
    if (!response.ok) throw new Error(`Open-Meteo respondió ${response.status}`);
    return parseWeather(await response.json());
  });
  cache.set(url, { at: now, value });
  // Un fallo no se guarda: el próximo intento vuelve a consultar.
  value.catch(() => {
    if (cache.get(url)?.value === value) cache.delete(url);
  });
  return value;
}
