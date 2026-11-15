/**
 * Estado del suelo de un lugar (seco, húmedo, embarrado, helado o con nieve) y el suelo que le
 * corresponde en el cálculo de ruedas. Funciones puras; la consulta está en
 * `services/groundForecast.ts` y el acceso desde la pantalla, en `useGroundNow.ts`.
 *
 * De dónde sale cada cosa:
 * - **Humedad del suelo:** la del modelo meteorológico de Open-Meteo, en m³ de agua por m³ de
 *   suelo, en los primeros 9 cm. Es una estimación para una celda de varios kilómetros.
 * - **Cuánta agua aguanta este suelo:** de su textura (SoilGrids), con las ecuaciones de Saxton y
 *   Rawls (2006): punto de marchitez, capacidad de campo y saturación. Los coeficientes se
 *   comprobaron contra el código del USDA que las implementa (WEPP, `saxpar.for`).
 * - **Los umbrales** (cuándo es «húmedo», cuándo «embarrado», cuánta lluvia moja la superficie)
 *   son un criterio de PROMETHEUS. La referencia es la capacidad de campo, como en los estudios de
 *   transitabilidad agrícola, que la miden por el déficit de humedad respecto a ella (Earl, 1997).
 * - **El barro necesita agua reciente.** La capacidad de campo es el agua que le queda a un suelo
 *   cuando acaba de drenar: unas horas en los arenosos, dos o tres días en los arcillosos (FAO).
 *   Si el modelo da más agua que esa y apenas ha llovido en una semana, lo que falla es la escala
 *   (la humedad del modelo es de su propio suelo, no del de este lugar) y no cuenta como barro.
 */
import suelos from "../../data/sueloReal.json";
import {
  DEFAULT_BULK_DENSITY,
  EARTH_SOILS,
  gravimetricPercent,
  respondsToMoisture,
  soilById,
  soilForMoisture,
  suggestSoil,
} from "../mission/wheelData";
import type { SoilFamily, SoilPreset, Texture } from "../mission/wheelData";

export const SOIL_STATE_SOURCES = {
  moisture: { label: "Open-Meteo: humedad del suelo, lluvia y tiempo del modelo meteorológico (CC BY 4.0)", url: "https://open-meteo.com/" },
  texture: { label: `${suelos.source.name} · ${suelos.source.citation}`, url: suelos.source.url },
  pedotransfer: {
    label: "Saxton y Rawls (2006), Soil Science Society of America Journal 70: agua que retiene un suelo según su textura",
    url: "https://doi.org/10.2136/sssaj2005.0117",
  },
  pedotransferCode: {
    label: "USDA-ARS, modelo WEPP (saxpar.for): las mismas ecuaciones, con las que se comprobaron los coeficientes",
    url: "https://infosys.ars.usda.gov/svn/code/weps1/branches/weps.src.wepp/src/lib_wepp/saxpar.for",
  },
  trafficability: {
    label: "Earl (1997), Soil and Tillage Research 40: transitabilidad a partir del déficit de humedad del suelo",
    url: "https://doi.org/10.1016/S0167-1987(96)01072-0",
  },
  fieldCapacity: {
    label: "FAO, manual de riego, capítulo 2 «Soil and water»: qué es la capacidad de campo y cuánto tarda un suelo en drenar",
    url: "https://www.fao.org/4/r4082e/r4082e03.htm",
  },
} as const;

export type GroundStateId = "seco" | "humedo" | "embarrado" | "helado" | "nevado";

export const GROUND_STATES: Record<GroundStateId, { name: string; symbol: string; tone: "bien" | "medio" | "mal"; detail: string }> = {
  seco: { name: "Seco", symbol: "✓", tone: "bien", detail: "El suelo tiene poca agua: está firme." },
  humedo: { name: "Húmedo", symbol: "~", tone: "medio", detail: "El suelo tiene agua, pero todavía la absorbe." },
  embarrado: { name: "Embarrado", symbol: "✕", tone: "mal", detail: "El suelo tiene más agua de la que retiene: cede bajo las ruedas y los pies." },
  helado: { name: "Helado", symbol: "~", tone: "medio", detail: "El agua del suelo está congelada: el suelo está duro." },
  nevado: { name: "Con nieve", symbol: "~", tone: "medio", detail: "Hay nieve sobre el suelo." },
};

// ---------- Cuánta agua aguanta un suelo ----------

/** Materia orgánica que se supone (% del peso): el mapa de texturas de la aplicación no la trae. */
export const ASSUMED_ORGANIC_MATTER = 2.5;

/** Suelo franco (40 % de arena, 20 % de arcilla) para los lugares sin textura en el mapa. */
export const GENERIC_TEXTURE = { sand: 40, clay: 20 } as const;

export interface WaterLimits {
  /** Punto de marchitez (1500 kPa), capacidad de campo (33 kPa) y saturación, en m³/m³. */
  wilting: number;
  fieldCapacity: number;
  saturation: number;
  /** true si no hay textura del lugar y los límites son los de un suelo franco. */
  generic: boolean;
}

/**
 * Ecuaciones 1, 2, 3 y 5 de la tabla 1 de Saxton y Rawls (2006). Arena y arcilla, en % del peso;
 * dentro se usan como fracción, y la materia orgánica en %.
 */
export function waterLimits(texture: Pick<Texture, "sand" | "clay"> | null | undefined): WaterLimits {
  const source = texture ?? GENERIC_TEXTURE;
  const s = source.sand / 100;
  // Las ecuaciones se ajustaron con suelos de hasta un 60 % de arcilla.
  const c = Math.min(source.clay, 60) / 100;
  const om = ASSUMED_ORGANIC_MATTER;

  const wiltingT = -0.024 * s + 0.487 * c + 0.006 * om + 0.005 * s * om - 0.013 * c * om + 0.068 * s * c + 0.031;
  const wilting = wiltingT + (0.14 * wiltingT - 0.02);

  const fieldT = -0.251 * s + 0.195 * c + 0.011 * om + 0.006 * s * om - 0.027 * c * om + 0.452 * s * c + 0.299;
  const fieldCapacity = fieldT + (1.283 * fieldT * fieldT - 0.374 * fieldT - 0.015);

  const excessT = 0.278 * s + 0.034 * c + 0.022 * om - 0.018 * s * om - 0.027 * c * om - 0.584 * s * c + 0.078;
  const excess = excessT + (0.636 * excessT - 0.107);
  const saturation = fieldCapacity + excess - 0.097 * s + 0.043;

  return { wilting, fieldCapacity, saturation, generic: !texture };
}

// ---------- El estado ----------

/** Criterios de PROMETHEUS para pasar de un estado a otro. */
export const GROUND_RULES = {
  /** Parte del agua útil (entre marchitez y capacidad de campo) desde la que el suelo cuenta como húmedo. */
  moistFraction: 0.5,
  /** Lluvia en tres días que moja la superficie aunque el modelo dé el suelo por seco, en mm. */
  rainWetsMm: 5,
  /** Lluvia en tres días que embarra un suelo que no sea arenoso, en mm. */
  rainMudsMm: 50,
  /** Lluvia en siete días sin la cual la humedad del modelo, por alta que sea, no cuenta como barro, en mm. */
  mudNeedsRainMm: 5,
  /** Desde este % de arena el suelo drena y no se embarra: mojado, sigue firme. */
  sandyPercent: 70,
  /** Espesor de nieve desde el que el suelo cuenta como nevado, en m. */
  snowDepthM: 0.02,
} as const;

export interface GroundInput {
  /** m³/m³ en los primeros 9 cm; null si el modelo no la da. */
  moisture: number | null;
  /** mm de lluvia de los últimos tres días. */
  rain3dMm: number;
  /** mm de lluvia de los últimos siete días; si falta, no se aplica la regla del agua reciente. */
  rain7dMm?: number | null;
  /** °C en la superficie del suelo. */
  soilTemp: number | null;
  /** m de nieve. */
  snowDepth: number | null;
}

export interface GroundReading {
  state: GroundStateId;
  moisture: number | null;
  /** Humedad como parte de la saturación de este suelo, de 0 a 1; null sin dato de humedad. */
  saturationShare: number | null;
  rain3dMm: number;
  /** Por qué tiene ese estado, en una frase llana. */
  reason: string;
}

const RANK: Record<"seco" | "humedo" | "embarrado", number> = { seco: 0, humedo: 1, embarrado: 2 };

/** Estado del suelo con la humedad del modelo, la lluvia reciente, la nieve y el hielo. */
export function groundReading(input: GroundInput, limits: WaterLimits, sandPercent: number | null): GroundReading {
  const { moisture, rain3dMm, soilTemp, snowDepth } = input;
  const rain7dMm = input.rain7dMm ?? null;
  const sandy = sandPercent !== null && sandPercent >= GROUND_RULES.sandyPercent;
  const share = moisture === null ? null : Math.min(1, Math.max(0, moisture / limits.saturation));
  const base = { moisture, saturationShare: share, rain3dMm };
  const mm = `${Math.round(rain3dMm)} mm`;

  if (snowDepth !== null && snowDepth >= GROUND_RULES.snowDepthM) {
    return { ...base, state: "nevado", reason: `Hay unos ${Math.round(snowDepth * 100)} cm de nieve sobre el suelo.` };
  }

  // Por la humedad del modelo.
  let state: "seco" | "humedo" | "embarrado" = "seco";
  let reason = "El modelo no da la humedad del suelo aquí: solo se mira la lluvia reciente.";
  if (moisture !== null) {
    const moistFrom = limits.wilting + GROUND_RULES.moistFraction * (limits.fieldCapacity - limits.wilting);
    state = moisture >= limits.fieldCapacity ? "embarrado" : moisture >= moistFrom ? "humedo" : "seco";
    const percent = Math.round(share! * 100);
    reason =
      state === "embarrado"
        ? `El suelo tiene más agua de la que puede retener (está al ${percent} % de su saturación): cede bajo las ruedas y los pies.`
        : state === "humedo"
          ? `El suelo tiene agua, pero todavía la absorbe (está al ${percent} % de su saturación).`
          : `El suelo tiene poca agua (está al ${percent} % de su saturación): está firme.`;
    // Sin agua reciente, un suelo ya ha drenado hasta su capacidad de campo: no puede estar por encima.
    if (state === "embarrado" && rain7dMm !== null && rain7dMm < GROUND_RULES.mudNeedsRainMm) {
      state = "humedo";
      reason = `El modelo da el suelo con mucha agua (${percent} % de su saturación), pero en 7 días solo han caído ${Math.round(rain7dMm)} mm: ya ha drenado y cuenta como húmedo, no embarrado.`;
    }
  }

  // Por la lluvia de los últimos tres días, que el modelo puede no haber repartido bien en su celda.
  if (rain3dMm >= GROUND_RULES.rainMudsMm && RANK[state] < RANK.embarrado) {
    state = "embarrado";
    reason = `Llovieron ${mm} en tres días: el suelo está cargado de agua.`;
  } else if (rain3dMm >= GROUND_RULES.rainWetsMm && RANK[state] < RANK.humedo) {
    state = "humedo";
    reason = `Llovieron ${mm} en tres días: la superficie está mojada.`;
  }

  // La arena drena: mojada sigue firme.
  if (sandy && state === "embarrado") {
    state = "humedo";
    reason = `${reason} Es un suelo arenoso, que drena: mojado, sigue firme.`;
  }

  if (soilTemp !== null && soilTemp <= 0 && state !== "seco") {
    return { ...base, state: "helado", reason: `El suelo tiene agua y está a ${Math.round(soilTemp)} °C: está congelado.` };
  }
  return { ...base, state, reason };
}

// ---------- El suelo del cálculo de ruedas ----------

const textures = suelos.sites as Record<string, Texture | null>;

/** Textura del lugar según SoilGrids, o null si el mapa no la tiene. */
export const textureOf = (placeId: string): Texture | null => textures[placeId] ?? null;

/** Clase de suelo del lugar para el cálculo de ruedas, la misma que sugiere la pestaña «Ruedas». */
export const familyOf = (placeId: string): SoilFamily => soilById(suggestSoil(textureOf(placeId)).id).family;

export interface WheelSoil {
  preset: SoilPreset;
  /** Humedad estimada del suelo en % del peso seco; null si no se pudo estimar. */
  moisturePercent: number | null;
  /** false si la clase solo tiene una fila publicada y la humedad no cambia el cálculo. */
  responds: boolean;
}

/**
 * La fila publicada que le toca a un suelo en un estado dado. El estado manda, para que el cálculo
 * de ruedas nunca contradiga lo que se dice del suelo:
 *
 * - **con nieve** → la fila de nieve;
 * - **embarrado** → la fila más húmeda publicada para su clase;
 * - **seco o húmedo** → de las demás filas, la de humedad más cercana a la del suelo;
 * - **helado** → la fila más seca de su clase (la tabla no trae suelo helado).
 *
 * Una clase con una sola fila (la arena) usa siempre esa. La humedad en peso sale de la del modelo
 * (en volumen) y de la densidad aparente del suelo.
 */
export function wheelSoil(
  family: SoilFamily,
  state: GroundStateId,
  moisture: number | null,
  bulkDensity: number | null,
): WheelSoil {
  const responds = respondsToMoisture(family);
  const moisturePercent = moisture === null ? null : gravimetricPercent(moisture, bulkDensity ?? DEFAULT_BULK_DENSITY);
  if (state === "nevado") return { preset: soilById("nieve"), moisturePercent, responds };
  // Las filas de cada clase van de la más seca a la más húmeda.
  const rows = EARTH_SOILS.filter((soil) => soil.family === family);
  const driest = rows[0] ?? EARTH_SOILS[0];
  if (!responds || state === "helado") return { preset: driest, moisturePercent, responds };
  if (state === "embarrado") return { preset: rows[rows.length - 1], moisturePercent, responds };
  if (moisturePercent === null) return { preset: driest, moisturePercent, responds };
  return { preset: soilForMoisture(family, moisturePercent, rows.slice(0, -1)), moisturePercent, responds };
}
