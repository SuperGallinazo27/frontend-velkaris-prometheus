/**
 * Temporada de un lugar: clima típico de cada mes y una valoración orientativa para trabajo de campo.
 *
 * Los promedios mensuales vienen de NASA POWER (`src/data/climaReal.json`, generado por
 * `scripts/clima/calcular.py`). Son de una celda de unos 50 km, así que la temperatura se ajusta
 * a la altitud real del lugar con el gradiente térmico estándar. Las horas de luz se calculan
 * con la latitud. La valoración es un criterio de PROMETHEUS, no un requisito oficial.
 */
import climate from "../../data/climaReal.json";

export type Rating = "favorable" | "aceptable" | "dificil";

export const RATINGS: Record<Rating, { name: string; symbol: string }> = {
  favorable: { name: "Favorable", symbol: "✓" },
  aceptable: { name: "Aceptable", symbol: "~" },
  dificil: { name: "Difícil", symbol: "✕" },
};

export const MONTHS = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
] as const;

/** Lo que entrega la fuente para un mes. */
export interface MonthClimate {
  /** °C, media del mes en la celda del modelo. */
  temperature: number;
  /** °C entre la máxima y la mínima típicas del día. */
  range: number;
  /** mm acumulados en el mes. */
  precipitation: number;
  /** m/s a 10 m de altura. */
  wind: number;
  /** % de cielo cubierto. */
  cloud: number;
}

export interface MonthProfile {
  /** 0 = enero. */
  index: number;
  /** °C, ya ajustados a la altitud del lugar. */
  temperature: number;
  temperatureMin: number;
  temperatureMax: number;
  /** mm al mes. */
  precipitation: number;
  /** km/h. */
  wind: number;
  /** %. */
  cloud: number;
  /** Horas de luz a mitad de mes. */
  daylight: number;
  rating: Rating;
  /** Por qué el mes no es favorable; vacío si lo es. */
  reasons: string[];
}

/** Gradiente térmico estándar: la temperatura baja unos 6,5 °C por cada kilómetro de altura. */
export const LAPSE_RATE = 6.5;

/**
 * Umbrales de la valoración. Un mes es «difícil» si supera algún límite de `hard` o si junta
 * `MANY_ISSUES` inconvenientes de `soft` a la vez; «aceptable» si supera alguno de `soft`
 * y «favorable» si no supera ninguno.
 */
export const LIMITS = {
  soft: { precipitation: 30, cold: -5, heat: 32, wind: 25, daylight: 8 },
  hard: { precipitation: 100, cold: -15, heat: 38, wind: 35, daylight: 4 },
} as const;

/** Cuántos inconvenientes moderados a la vez vuelven difícil un mes. */
export const MANY_ISSUES = 3;

/** Día del año a mitad de cada mes. */
const MID_MONTH_DAY = [15, 46, 74, 105, 135, 166, 196, 227, 258, 288, 319, 349];

/** Horas entre la salida y la puesta del sol a mitad de mes; 0 en la noche polar y 24 con sol de medianoche. */
export function daylightHours(latitude: number, month: number): number {
  const toRad = Math.PI / 180;
  const declination = 23.44 * Math.sin(((2 * Math.PI) / 365) * (284 + MID_MONTH_DAY[month]));
  const cosHourAngle = -Math.tan(latitude * toRad) * Math.tan(declination * toRad);
  if (cosHourAngle <= -1) return 24;
  if (cosHourAngle >= 1) return 0;
  return (2 * Math.acos(cosHourAngle)) / toRad / 15;
}

/** Temperatura de la celda del modelo llevada a la altitud del lugar. Sin altitud conocida, no se toca. */
export function adjustTemperature(temperature: number, cellElevation: number, siteElevation: number | null): number {
  if (siteElevation === null) return temperature;
  return temperature - (LAPSE_RATE * (siteElevation - cellElevation)) / 1000;
}

export function rate(month: Omit<MonthProfile, "rating" | "reasons" | "index">): Pick<MonthProfile, "rating" | "reasons"> {
  const hard: string[] = [];
  const soft: string[] = [];
  const add = (isHard: boolean, isSoft: boolean, hardReason: string, softReason: string) => {
    if (isHard) hard.push(hardReason);
    else if (isSoft) soft.push(softReason);
  };
  const water = month.temperature <= 0 ? "nieve" : "lluvia";
  add(
    month.precipitation > LIMITS.hard.precipitation,
    month.precipitation >= LIMITS.soft.precipitation,
    `mucha ${water}`,
    water,
  );
  add(month.temperatureMin < LIMITS.hard.cold, month.temperatureMin < LIMITS.soft.cold, "frío extremo", "frío");
  add(month.temperatureMax > LIMITS.hard.heat, month.temperatureMax > LIMITS.soft.heat, "calor extremo", "calor");
  add(month.wind > LIMITS.hard.wind, month.wind >= LIMITS.soft.wind, "viento fuerte", "viento");
  add(
    month.daylight < LIMITS.hard.daylight,
    month.daylight < LIMITS.soft.daylight,
    "casi sin luz",
    "pocas horas de luz",
  );
  const difficult = hard.length > 0 || soft.length >= MANY_ISSUES;
  return { rating: difficult ? "dificil" : soft.length ? "aceptable" : "favorable", reasons: [...hard, ...soft] };
}

/** Los doce meses de un lugar, con la temperatura ajustada a su altitud. */
export function yearProfile(
  months: readonly MonthClimate[],
  latitude: number,
  cellElevation: number,
  siteElevation: number | null,
): MonthProfile[] {
  return months.map((month, index) => {
    const temperature = adjustTemperature(month.temperature, cellElevation, siteElevation);
    const values = {
      temperature,
      temperatureMin: temperature - month.range / 2,
      temperatureMax: temperature + month.range / 2,
      precipitation: month.precipitation,
      wind: month.wind * 3.6,
      cloud: month.cloud,
      daylight: daylightHours(latitude, index),
    };
    return { index, ...values, ...rate(values) };
  });
}

export interface Window {
  rating: Rating;
  /** Primer y último mes de la racha, de 0 a 11. Puede cruzar de diciembre a enero. */
  start: number;
  end: number;
  length: number;
}

/**
 * La racha más larga de meses seguidos con la mejor valoración que tenga el lugar.
 * Devuelve null si todos los meses son difíciles.
 */
export function bestWindow(year: readonly MonthProfile[]): Window | null {
  const rating: Rating | null = year.some((m) => m.rating === "favorable")
    ? "favorable"
    : year.some((m) => m.rating === "aceptable")
      ? "aceptable"
      : null;
  if (!rating) return null;
  const good = year.map((m) => m.rating === rating);
  if (good.every(Boolean)) return { rating, start: 0, end: 11, length: 12 };

  let best: Window | null = null;
  for (let start = 0; start < 12; start++) {
    // Una racha empieza donde el mes anterior no es bueno.
    if (!good[start] || good[(start + 11) % 12]) continue;
    let length = 1;
    while (good[(start + length) % 12]) length++;
    if (!best || length > best.length) best = { rating, start, end: (start + length - 1) % 12, length };
  }
  return best;
}

/** Estación del año según el hemisferio; null entre los trópicos, donde manda la lluvia. */
export function seasonName(latitude: number, month: number): string | null {
  if (Math.abs(latitude) < 23.44) return null;
  const northern = ["Invierno", "Invierno", "Primavera", "Primavera", "Primavera", "Verano", "Verano", "Verano", "Otoño", "Otoño", "Otoño", "Invierno"];
  const name = northern[month];
  if (latitude > 0) return name;
  return { Invierno: "Verano", Verano: "Invierno", Primavera: "Otoño", Otoño: "Primavera" }[name]!;
}

/** Una frase corta para el mes: «Otoño · mucha lluvia», «Temporada seca». */
export function describeMonth(month: MonthProfile, latitude: number): string {
  const water = month.temperature <= 0 ? "nieve" : "lluvia";
  const season = seasonName(latitude, month.index);
  if (month.precipitation >= 80) return season ? `${season} · mucha ${water}` : "Temporada de lluvias";
  if (month.precipitation < 20) return season ? `${season} · seco` : "Temporada seca";
  return season ? `${season} · algo de ${water}` : "Lluvias moderadas";
}

/** Días de cada mes, sin años bisiestos: para repartir la lluvia típica alcanza. */
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const DAY_MS = 86_400_000;

/**
 * Lluvia típica entre dos fechas (`2026-10-16`), las dos incluidas, repartiendo la de cada mes
 * entre sus días. Es con lo que se compara la lluvia que de verdad cayó en ese mismo periodo.
 */
export function typicalRain(year: readonly { precipitation: number }[], from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 0;
  let total = 0;
  for (let day = start; day <= end; day += DAY_MS) {
    const month = new Date(day).getUTCMonth();
    total += year[month].precipitation / MONTH_DAYS[month];
  }
  return total;
}

/** Cómo queda la lluvia real frente a la típica de esas mismas fechas. */
export type RainCheck = "mucho-mas" | "mas" | "normal" | "menos";

/**
 * Cuándo la lluvia real se aparta de la típica. Hace falta que cambie la proporción y también
 * la cantidad: en un desierto, pasar de 1 a 4 mm no es noticia.
 */
export const RAIN_CHECK = { more: 1.5, muchMore: 3, less: 0.5, minDifferenceMm: 20 } as const;

export function compareRain(actualMm: number, typicalMm: number): RainCheck {
  const difference = actualMm - typicalMm;
  if (difference >= RAIN_CHECK.minDifferenceMm && actualMm >= typicalMm * RAIN_CHECK.muchMore) return "mucho-mas";
  if (difference >= RAIN_CHECK.minDifferenceMm && actualMm >= typicalMm * RAIN_CHECK.more) return "mas";
  if (-difference >= RAIN_CHECK.minDifferenceMm && actualMm <= typicalMm * RAIN_CHECK.less) return "menos";
  return "normal";
}

/**
 * El mes de ahora, valorado con la lluvia que de verdad cayó en los últimos 30 días en lugar de
 * la típica. Lo demás (temperatura, viento, luz) sigue siendo el promedio del mes.
 */
export function rateNow(month: MonthProfile, actualMm: number): Pick<MonthProfile, "rating" | "reasons"> {
  return rate({ ...month, precipitation: actualMm });
}

/** Lo que de verdad se sabe de hoy. Lo que falte se queda con el valor típico del mes. */
export interface TodayFacts {
  /** mm de lluvia de los últimos 30 días. */
  rain30dMm?: number | null;
  /** °C del aire hoy: la más baja y la más alta. */
  temperatureMin?: number | null;
  temperatureMax?: number | null;
  /** Viento medio de hoy, km/h. */
  wind?: number | null;
  /** Estado del suelo (ver `soilState.ts`). */
  ground?: "seco" | "humedo" | "embarrado" | "helado" | "nevado" | null;
}

/** La lluvia de la valoración de hoy es la de los últimos 30 días: se dice así. */
const RAIN_TODAY: Record<string, string> = {
  "mucha lluvia": "mucha lluvia en 30 días",
  lluvia: "lluvia en 30 días",
  "mucha nieve": "mucha nieve en 30 días",
  nieve: "nieve en 30 días",
};

/**
 * Valoración de hoy para trabajo de campo, con datos reales: la lluvia de los últimos 30 días, la
 * temperatura y el viento de hoy y el estado del suelo. Un suelo embarrado hace el día difícil
 * aunque hoy no llueva; la nieve en el suelo, como poco, lo deja en aceptable.
 */
export function rateToday(month: MonthProfile, facts: TodayFacts): Pick<MonthProfile, "rating" | "reasons"> {
  const temperatureMin = facts.temperatureMin ?? month.temperatureMin;
  const temperatureMax = facts.temperatureMax ?? month.temperatureMax;
  const real = facts.temperatureMin != null && facts.temperatureMax != null;
  const base = rate({
    ...month,
    temperature: real ? (temperatureMin + temperatureMax) / 2 : month.temperature,
    temperatureMin,
    temperatureMax,
    precipitation: facts.rain30dMm ?? month.precipitation,
    wind: facts.wind ?? month.wind,
  });
  const reasons = base.reasons.map((reason) => (facts.rain30dMm != null ? (RAIN_TODAY[reason] ?? reason) : reason));
  if (facts.ground === "embarrado") return { rating: "dificil", reasons: ["terreno embarrado", ...reasons] };
  if (facts.ground === "nevado") {
    return { rating: base.rating === "favorable" ? "aceptable" : base.rating, reasons: [...reasons, "nieve en el suelo"] };
  }
  return { rating: base.rating, reasons };
}

export interface Season {
  year: MonthProfile[];
  window: Window | null;
  /** false si no se conoce la altitud del lugar y la temperatura es la de la celda del modelo. */
  adjusted: boolean;
  cellElevation: number;
}

const climateById = new Map(climate.sites.map((site) => [site.id, site]));

/** Temporada de un lugar de la lista, o null si no tiene clima calculado. */
export function seasonOf(zoneId: string, latitude: number, siteElevation: number | null): Season | null {
  const site = climateById.get(zoneId);
  if (!site) return null;
  const year = yearProfile(site.months, latitude, site.cellElevation, siteElevation);
  return { year, window: bestWindow(year), adjusted: siteElevation !== null, cellElevation: site.cellElevation };
}

export const climateSource = climate.source;
