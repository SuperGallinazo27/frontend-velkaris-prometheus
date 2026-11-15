/**
 * Cuánto llovió en estas mismas fechas en años anteriores, desde el archivo de Open-Meteo. Es con
 * lo que se compara la lluvia de los últimos 30 días (`recentRain.ts`) para decir si es habitual.
 *
 * Por qué no se compara con el clima típico de la aplicación (NASA POWER): son dos modelos con
 * celdas de tamaño distinto (unos 50 km frente a 9 km) y en montaña o en islas dan cantidades
 * muy diferentes. Para el Etna, la lluvia media de mayo es de 21 mm en uno y de unos 100 mm en el
 * otro: compararlos entre sí haría pasar por anomalía lo que solo es otra fuente.
 *
 * - Una consulta pequeña por año (30 días cada una), en paralelo.
 * - Solo desde 2017: desde entonces el archivo da el modelo IFS de ECMWF a 9 km, el mismo de los
 *   días recientes. Antes da ERA5, que reparte la lluvia de otra manera.
 * - Son pocos años: sirven para decir qué ha sido habitual, no para una estadística del clima.
 */
import { ARCHIVE_ENDPOINT } from "./recentRain";

/** Primer año en que el archivo da el mismo modelo que los días recientes. */
export const BASELINE_FIRST_YEAR = 2017;

/** Años anteriores que se consultan, como mucho. */
export const BASELINE_YEARS = 9;

/** Con menos años que estos no se dice qué es lo habitual. */
export const BASELINE_MIN_YEARS = 5;

/** Parte de los días del periodo que deben traer dato para que un año cuente. */
const MIN_DAYS_SHARE = 0.8;

const CACHE_MS = 6 * 60 * 60 * 1000;
const DAY_MS = 86_400_000;

export interface BaselineYear {
  /** Año en que acaba el periodo. */
  year: number;
  totalMm: number;
}

export interface RainBaseline {
  /** Un total por año, del más antiguo al más reciente. */
  years: BaselineYear[];
  meanMm: number;
  minMm: number;
  maxMm: number;
}

export interface BaselineWindow {
  year: number;
  start: string;
  end: string;
}

const isLeap = (year: number) => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

/** La misma fecha, `years` años antes. El 29 de febrero pasa al 28 si ese año no es bisiesto. */
function yearsBefore(date: string, years: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const target = year - years;
  const safeDay = month === 2 && day === 29 && !isLeap(target) ? 28 : day;
  return `${target}-${String(month).padStart(2, "0")}-${String(safeDay).padStart(2, "0")}`;
}

/** Las mismas fechas (`2026-10-16` a `2026-11-14`) en los años anteriores que se pueden comparar. */
export function baselineWindows(from: string, to: string): BaselineWindow[] {
  const startYear = Number(from.slice(0, 4));
  const endYear = Number(to.slice(0, 4));
  if (!Number.isFinite(startYear) || !Number.isFinite(endYear) || to < from) return [];
  const windows: BaselineWindow[] = [];
  for (let back = BASELINE_YEARS; back >= 1; back--) {
    // El periodo entero tiene que caer en los años del mismo modelo.
    if (startYear - back < BASELINE_FIRST_YEAR) continue;
    windows.push({ year: endYear - back, start: yearsBefore(from, back), end: yearsBefore(to, back) });
  }
  return windows;
}

export function baselineUrl(latitude: number, longitude: number, window: BaselineWindow): string {
  const params = new URLSearchParams({
    latitude: latitude.toFixed(4),
    longitude: longitude.toFixed(4),
    start_date: window.start,
    end_date: window.end,
    daily: "precipitation_sum",
    timezone: "auto",
  });
  return `${ARCHIVE_ENDPOINT}?${params}`;
}

/** mm del periodo en la respuesta de un año; null si le faltan demasiados días. */
export function parseWindowTotal(body: unknown, window: BaselineWindow): number | null {
  const sums = (body as { daily?: { precipitation_sum?: unknown } } | null)?.daily?.precipitation_sum;
  if (!Array.isArray(sums)) return null;
  const values = sums.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const expected = Math.round((Date.parse(`${window.end}T00:00:00Z`) - Date.parse(`${window.start}T00:00:00Z`)) / DAY_MS) + 1;
  if (!values.length || values.length < expected * MIN_DAYS_SHARE) return null;
  return Math.round(values.reduce((sum, value) => sum + value, 0) * 10) / 10;
}

/** Media, mínimo y máximo de los años consultados. */
export function summarize(years: BaselineYear[]): RainBaseline {
  const totals = years.map((item) => item.totalMm);
  return {
    years,
    meanMm: Math.round((totals.reduce((sum, value) => sum + value, 0) / totals.length) * 10) / 10,
    minMm: Math.min(...totals),
    maxMm: Math.max(...totals),
  };
}

const cache = new Map<string, { at: number; value: Promise<RainBaseline> }>();

/**
 * Lluvia de las fechas `from`–`to` en cada año anterior. Un año que falle se deja fuera; lanza un
 * error si quedan menos de `BASELINE_MIN_YEARS`.
 */
export function fetchRainBaseline(
  latitude: number,
  longitude: number,
  from: string,
  to: string,
  fetcher: typeof fetch = fetch,
  now = Date.now(),
): Promise<RainBaseline> {
  const key = `${latitude.toFixed(4)}|${longitude.toFixed(4)}|${from}|${to}`;
  const hit = cache.get(key);
  if (hit && now - hit.at < CACHE_MS) return hit.value;

  const value = Promise.all(
    baselineWindows(from, to).map(async (window): Promise<BaselineYear | null> => {
      try {
        const response = await fetcher(baselineUrl(latitude, longitude, window));
        if (!response.ok) return null;
        const totalMm = parseWindowTotal(await response.json(), window);
        return totalMm === null ? null : { year: window.year, totalMm };
      } catch {
        return null;
      }
    }),
  ).then((results) => {
    const years = results.filter((item): item is BaselineYear => item !== null);
    if (years.length < BASELINE_MIN_YEARS) throw new Error("Sin años suficientes para comparar la lluvia");
    return summarize(years);
  });
  cache.set(key, { at: now, value });
  // Un fallo no se guarda: el próximo intento vuelve a consultar.
  value.catch(() => {
    if (cache.get(key)?.value === value) cache.delete(key);
  });
  return value;
}
