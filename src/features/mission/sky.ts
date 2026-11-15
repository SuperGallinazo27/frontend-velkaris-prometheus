/**
 * El cielo del simulador: cómo se convierten el Sol real del lugar y el tiempo que hace ahora
 * (Open-Meteo) en colores, luces, nubes, lluvia o nieve y neblina. Funciones puras; las dibuja
 * `robotScene.ts`.
 *
 * Es una representación para ver el lugar con el tiempo de ahora, no un modelo de la atmósfera:
 * las nubes y las gotas son dibujos cuya cantidad sigue al dato real.
 */
import type { CurrentWeather } from "../../services/weather";
import type { SceneLight } from "./sun";

export type Precipitation = "ninguna" | "lluvia" | "nieve";

export interface WeatherSky {
  /** Fracción de cielo cubierto, de 0 a 1. */
  cloud: number;
  precipitation: Precipitation;
  /** Fuerza de la lluvia o la nieve, de 0 a 1. */
  intensity: number;
  /** Niebla, de 0 a 1. */
  fog: number;
  /** Viento en m/s y hacia dónde sopla (este y norte, vector unitario). */
  windSpeed: number;
  windEast: number;
  windNorth: number;
}

/** Cielo despejado y en calma: lo que se muestra si no hay dato del tiempo. */
export const CLEAR_SKY: WeatherSky = { cloud: 0.08, precipitation: "ninguna", intensity: 0, fog: 0, windSpeed: 0, windEast: 1, windNorth: 0 };

const SNOW_CODES = new Set([71, 73, 75, 77, 85, 86]);
const RAIN_CODES = new Set([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99]);
/** Fuerza por código WMO: ligera, moderada o fuerte. */
const STRENGTH: Record<number, number> = {
  51: 0.25, 56: 0.25, 61: 0.4, 66: 0.4, 80: 0.45, 71: 0.4, 85: 0.45, 77: 0.3,
  53: 0.4, 57: 0.5, 63: 0.65, 67: 0.7, 81: 0.7, 73: 0.65,
  55: 0.55, 65: 1, 82: 1, 75: 1, 86: 1, 95: 1, 96: 1, 99: 1,
};

/** Del tiempo de ahora (códigos WMO de Open-Meteo) a lo que se dibuja en el cielo. */
export function weatherSky(weather: CurrentWeather | null): WeatherSky {
  if (!weather) return CLEAR_SKY;
  const precipitation: Precipitation = SNOW_CODES.has(weather.code) ? "nieve" : RAIN_CODES.has(weather.code) ? "lluvia" : "ninguna";
  const intensity = precipitation === "ninguna" ? 0 : (STRENGTH[weather.code] ?? 0.5);
  const fog = weather.code === 45 || weather.code === 48 ? 1 : 0;
  // La dirección del viento es de dónde viene, en grados desde el norte: sopla hacia el lado contrario.
  const from = (weather.windDirection * Math.PI) / 180;
  return {
    // Con lluvia o niebla el cielo se ve cubierto aunque el modelo dé menos nubosidad.
    cloud: Math.min(1, Math.max(weather.cloudCover / 100, precipitation === "ninguna" ? 0 : 0.85, fog ? 0.9 : 0)),
    precipitation,
    intensity,
    fog,
    windSpeed: weather.windSpeed / 3.6,
    windEast: -Math.sin(from),
    windNorth: -Math.cos(from),
  };
}

export interface SkyState extends WeatherSky {
  /** Altura y acimut del Sol con el que se ilumina la escena, en grados. */
  elevation: number;
  azimuth: number;
}

export type RGB = [number, number, number];

const hex = (value: string): RGB => [1, 3, 5].map((k) => parseInt(value.slice(k, k + 2), 16) / 255) as RGB;
const mix = (a: RGB, b: RGB, t: number): RGB => a.map((v, k) => v + (b[k] - v) * t) as RGB;
const scale = (a: RGB, s: number): RGB => a.map((v) => v * s) as RGB;
const smooth = (edge0: number, edge1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

export interface SkyPalette {
  /** Colores en sRGB, de 0 a 1. */
  zenith: RGB;
  horizon: RGB;
  sun: RGB;
  cloudLight: RGB;
  cloudDark: RGB;
  /** Luz directa del Sol y luz difusa del cielo. */
  sunIntensity: number;
  skyIntensity: number;
  /** Cuánto se ven el disco del Sol y las estrellas, de 0 a 1. */
  sunDisc: number;
  stars: number;
  /** Densidad de la neblina (por metro, al cuadrado en la fórmula de Three.js). */
  fogDensity: number;
  /** 1 de día, 0 de noche. */
  day: number;
}

/** Colores y luces del cielo para una altura del Sol y un tiempo dados. */
export function skyPalette(state: SkyState): SkyPalette {
  const day = smooth(-6, 8, state.elevation);
  // Sol bajo: tonos cálidos.
  const golden = day * (1 - smooth(5, 24, state.elevation));
  const cover = state.cloud;
  const wet = state.precipitation === "ninguna" ? 0 : state.intensity;

  let zenith = mix(hex("#04070f"), mix(hex("#2c6fc7"), hex("#40659c"), golden), day);
  let horizon = mix(hex("#0c1422"), mix(hex("#b7d3ee"), hex("#f0b98a"), golden), day);
  // Cubierto: el cielo se vuelve gris, más oscuro si llueve.
  const grey = scale(mix(hex("#1a1e26"), hex("#a3abb5"), day), 1 - 0.38 * wet);
  zenith = mix(zenith, scale(grey, 0.86), cover * 0.9);
  horizon = mix(horizon, mix(grey, hex("#c9ced4"), day * 0.5 * (1 - wet)), cover * 0.82);
  let cloudLight = scale(mix(hex("#2a2f38"), mix(hex("#ffffff"), hex("#ffd9b8"), golden), day), 1 - 0.3 * wet);
  let cloudDark = scale(mix(hex("#12151b"), hex("#8c95a1"), day), 1 - 0.35 * wet);
  if (state.fog > 0) {
    // Con niebla el cielo es un gris parejo: las nubes casi no se distinguen.
    const mist = mix(hex("#20242b"), hex("#c4c9cf"), day);
    zenith = mix(zenith, mist, state.fog * 0.85);
    horizon = mix(horizon, mist, state.fog * 0.95);
    cloudLight = mix(cloudLight, mist, state.fog * 0.85);
    cloudDark = mix(cloudDark, mist, state.fog * 0.8);
  }

  return {
    zenith,
    horizon,
    sun: mix(hex("#fff4e2"), hex("#ffb26a"), golden),
    cloudLight,
    cloudDark,
    sunIntensity: 3.1 * smooth(-1, 12, state.elevation) * (1 - 0.82 * cover) * (1 - 0.8 * state.fog),
    // Cubierto, toda la luz llega del cielo: casi tanta como la del Sol en un día despejado.
    skyIntensity: 0.12 + day * (0.62 + 1.15 * cover),
    sunDisc: day * (1 - cover) * (1 - state.fog),
    stars: (1 - day) * (1 - cover),
    fogDensity: 0.00003 + 0.00003 * cover + (state.precipitation === "nieve" ? 0.0005 : 0.00028) * wet + 0.0045 * state.fog,
    day,
  };
}

/** Lo que dice la etiqueta de la luz, según con qué Sol se ilumina la escena. */
export function lightLabel(light: SceneLight, realNight: boolean, clockText: string | null): string {
  if (realNight) return "Noche real del lugar";
  if (light.mode === "real") return clockText ? `Sol real de ahora (${clockText} allí)` : "Sol real de ahora";
  if (light.mode === "manana") return "Allí es de noche: se ve con la luz de las 9:30";
  if (light.mode === "mediodia") return "Allí el Sol está bajo el horizonte: se ve con la luz del mediodía";
  return "Noche polar: luz de referencia, no es la real";
}
