/**
 * El Niño y La Niña: qué dice el índice de NOAA y cómo se cuenta en la ficha de un lugar.
 * Funciones puras; la consulta está en `services/enso.ts`.
 *
 * El índice es el ONI (Oceanic Niño Index): cuánto se aparta de lo normal la temperatura del mar
 * en el Pacífico ecuatorial central (región Niño 3.4), en promedios de tres meses. NOAA habla de
 * condiciones de El Niño desde +0,5 °C y de La Niña desde −0,5 °C, y de un episodio cuando se
 * mantienen cinco trimestres seguidos.
 */

export interface OniReading {
  /** Trimestre con las iniciales en inglés de sus meses: «ASO» es agosto, septiembre y octubre. */
  season: string;
  year: number;
  /** °C por encima (+) o por debajo (−) de lo normal. */
  oni: number;
}

export interface EnsoData {
  /** Día en que se leyó la fuente (`2026-11-15`). */
  fetchedAt: string;
  /** Últimos trimestres publicados, del más antiguo al más reciente. */
  recent: OniReading[];
  /** Temperatura semanal del mar; la región Niño 1+2 está frente a Ecuador y Perú. */
  weekly: { week: string; nino12: { sst: number; anomaly: number }; nino34: { sst: number; anomaly: number } } | null;
  source: { name: string; oni: string; weekly: string };
}

export type EnsoState = "nino" | "nina" | "neutral";

/** Umbral de NOAA para hablar de El Niño o La Niña, en °C. */
export const ENSO_THRESHOLD = 0.5;
/** Trimestres seguidos que hacen un episodio. */
export const EPISODE_SEASONS = 5;

/** Intensidad según el tamaño de la anomalía. Es la escala habitual, no una categoría oficial de NOAA. */
const STRENGTHS: { from: number; name: string }[] = [
  { from: 2, name: "muy fuerte" },
  { from: 1.5, name: "fuerte" },
  { from: 1, name: "moderado" },
  { from: ENSO_THRESHOLD, name: "débil" },
];

const SEASON_MONTHS: Record<string, string> = {
  DJF: "diciembre a febrero",
  JFM: "enero a marzo",
  FMA: "febrero a abril",
  MAM: "marzo a mayo",
  AMJ: "abril a junio",
  MJJ: "mayo a julio",
  JJA: "junio a agosto",
  JAS: "julio a septiembre",
  ASO: "agosto a octubre",
  SON: "septiembre a noviembre",
  OND: "octubre a diciembre",
  NDJ: "noviembre a enero",
};

export interface EnsoStatus {
  state: EnsoState;
  /** «débil», «moderado», «fuerte» o «muy fuerte»; null en estado neutral. */
  strength: string | null;
  /** true si el umbral se mantiene cinco trimestres seguidos. */
  episode: boolean;
  oni: number;
  /** «agosto a octubre de 2026». */
  period: string;
}

export function ensoStatus(data: EnsoData): EnsoStatus | null {
  const last = data.recent[data.recent.length - 1];
  if (!last) return null;
  const state: EnsoState = last.oni >= ENSO_THRESHOLD ? "nino" : last.oni <= -ENSO_THRESHOLD ? "nina" : "neutral";
  const sign = state === "nina" ? -1 : 1;
  const strength = state === "neutral" ? null : STRENGTHS.find((s) => last.oni * sign >= s.from)!.name;
  const tail = data.recent.slice(-EPISODE_SEASONS);
  const episode =
    state !== "neutral" && tail.length === EPISODE_SEASONS && tail.every((r) => r.oni * sign >= ENSO_THRESHOLD);
  return { state, strength, episode, oni: last.oni, period: `${SEASON_MONTHS[last.season] ?? last.season} de ${last.year}` };
}

/**
 * true cerca de la región Niño 1+2 (de 0° a 10° S y de 90° a 80° O, frente a Ecuador y Perú),
 * con un margen que incluye Galápagos y la sierra ecuatoriana. Ahí el calentamiento del mar
 * costero se nota de forma directa en la lluvia.
 */
export function nearNino12(latitude: number, longitude: number): boolean {
  return latitude >= -12 && latitude <= 3 && longitude >= -95 && longitude <= -75;
}

const degrees = (value: number) => Math.abs(value).toLocaleString("es", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** Una frase en lenguaje llano para la ficha; null si el Pacífico está en estado neutral. */
export function ensoSentence(status: EnsoStatus): string | null {
  if (status.state === "neutral") return null;
  const name = status.state === "nino" ? "El Niño" : "La Niña";
  const side = status.state === "nino" ? "más caliente" : "más frío";
  const active = status.episode ? "activo" : "en desarrollo";
  return `${name} ${status.strength} ${active}: el Pacífico ecuatorial está ${degrees(status.oni)} °C ${side} de lo normal (${status.period}).`;
}
