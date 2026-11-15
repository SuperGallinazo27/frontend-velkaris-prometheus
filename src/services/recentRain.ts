/**
 * Lluvia que de verdad cayó en un punto en los últimos 30 días, desde el archivo de Open-Meteo.
 *
 * - Sale del archivo, y no de la API de pronóstico, para poder comparar igual con igual: desde
 *   2017 el archivo da el análisis de un mismo modelo (IFS de ECMWF, 9 km), y con él se consultan
 *   esas mismas fechas en años anteriores (`rainBaseline.ts`). La API de pronóstico usa en cada
 *   región el modelo que mejor le parece y sus totales no son comparables con los del archivo: el
 *   15 de noviembre de 2026 daba 42 mm en el Etna para los mismos 30 días en que el archivo da 146.
 * - Es el análisis de un modelo meteorológico para esas coordenadas, no un pluviómetro.
 * - Gratuito y sin clave para uso no comercial; datos bajo CC BY 4.0 (hay que citar a Open-Meteo).
 */
export const ARCHIVE_ENDPOINT = "https://archive-api.open-meteo.com/v1/archive";

/** Días completos que se suman. */
export const RECENT_DAYS = 30;

/** Con menos días con dato que estos, el total no representa el periodo. */
const MIN_DAYS = 25;

/** El dato cambia una vez al día: una hora de caché sobra. */
const CACHE_MS = 60 * 60 * 1000;

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/** Días que se piden de más: según la zona horaria, el último día completo del lugar cambia. */
const EXTRA_DAYS = 2;

export interface RecentRain {
  /** mm acumulados en los días con dato. */
  totalMm: number;
  /** Días con dato dentro del periodo. */
  days: number;
  /** Primer y último día sumados (`2026-10-16`), en la fecha local del lugar. */
  from: string;
  to: string;
  /** mm del día más lluvioso. */
  wettestMm: number;
}

const isoDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function recentRainUrl(latitude: number, longitude: number, now: number = Date.now()): string {
  // El archivo no admite fechas posteriores a hoy (UTC). Se pide hasta el día de hace una hora
  // para que un reloj algo adelantado no provoque un error justo después de la medianoche.
  const end = now - HOUR_MS;
  const params = new URLSearchParams({
    latitude: latitude.toFixed(4),
    longitude: longitude.toFixed(4),
    start_date: isoDate(end - (RECENT_DAYS + EXTRA_DAYS) * DAY_MS),
    end_date: isoDate(end),
    daily: "precipitation_sum",
    timezone: "auto",
  });
  return `${ARCHIVE_ENDPOINT}?${params}`;
}

/**
 * Convierte la respuesta del servicio; lanza un error si no trae días suficientes. Suma los 30
 * días anteriores a hoy en la fecha del lugar: el día de hoy, todavía incompleto, no se cuenta.
 */
export function parseRecentRain(body: unknown, now: number = Date.now()): RecentRain {
  const data = body as { utc_offset_seconds?: unknown; daily?: { time?: unknown; precipitation_sum?: unknown } } | null;
  const times = Array.isArray(data?.daily?.time) ? (data.daily.time as unknown[]) : [];
  const sums = Array.isArray(data?.daily?.precipitation_sum) ? (data.daily.precipitation_sum as unknown[]) : [];
  const offset = typeof data?.utc_offset_seconds === "number" ? data.utc_offset_seconds : 0;
  const today = isoDate(now + offset * 1000);

  const past: { date: string; mm: unknown }[] = [];
  for (let i = 0; i < Math.min(times.length, sums.length); i++) {
    const date = times[i];
    if (typeof date === "string" && date < today) past.push({ date, mm: sums[i] });
  }
  const days = past
    .slice(-RECENT_DAYS)
    .filter((day): day is { date: string; mm: number } => typeof day.mm === "number" && Number.isFinite(day.mm));
  if (days.length < MIN_DAYS) throw new Error("Respuesta sin días suficientes de precipitación");
  return {
    totalMm: Math.round(days.reduce((sum, day) => sum + day.mm, 0) * 10) / 10,
    days: days.length,
    from: days[0].date,
    to: days[days.length - 1].date,
    wettestMm: Math.max(...days.map((day) => day.mm)),
  };
}

const cache = new Map<string, { at: number; value: Promise<RecentRain> }>();

export function fetchRecentRain(
  latitude: number,
  longitude: number,
  fetcher: typeof fetch = fetch,
  now = Date.now(),
): Promise<RecentRain> {
  const url = recentRainUrl(latitude, longitude, now);
  const hit = cache.get(url);
  if (hit && now - hit.at < CACHE_MS) return hit.value;

  const value = fetcher(url).then(async (response) => {
    if (!response.ok) throw new Error(`Open-Meteo respondió ${response.status}`);
    return parseRecentRain(await response.json(), now);
  });
  cache.set(url, { at: now, value });
  // Un fallo no se guarda: el próximo intento vuelve a consultar.
  value.catch(() => {
    if (cache.get(url)?.value === value) cache.delete(url);
  });
  return value;
}
