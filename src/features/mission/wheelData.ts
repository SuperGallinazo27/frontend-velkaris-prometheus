/**
 * Datos publicados para el cálculo rueda-suelo: los vehículos, los suelos y las comprobaciones
 * contra mediciones reales. Cada valor lleva su fuente. Unidades del SI (kc en N/m^(n+1),
 * kφ en N/m^(n+2), cohesión en Pa, K en m).
 *
 * Lo que nadie ha medido no se inventa: K y las constantes c1 y c2 faltan en varias fuentes y se
 * toman de la literatura de arenas; cada suelo lo dice en `assumed`.
 */
import type { Soil, StressShape, Vehicle } from "./terramechanics";

// La gravedad de la Luna (NASA NSSDC, 1,62 m/s²) y la de la Tierra ya están en el gemelo digital.
export { EARTH_GRAVITY, MOON_GRAVITY } from "./twin";

export interface Source {
  label: string;
  url: string;
}

export const SOURCES = {
  viperBriefing: {
    label: "NASA, VIPER Technical Briefing (13 feb 2025), diapositivas 46-47",
    url: "https://assets.science.nasa.gov/content/dam/science/psd/lunar-science/documents/2025-02-13_VIPER_Updated_Technical_Briefing_Presentation-Shared.pdf",
  },
  viperWheel: {
    label: "Schepelmann y otros (2025), Planetary Science Journal: rueda de VIPER y requisito de patinaje",
    url: "https://doi.org/10.3847/PSJ/add13f",
  },
  slopeLab: {
    label: "NASA Glenn, laboratorio SLOPE (2022): patinaje medido de la versión aligerada de VIPER",
    url: "https://ntrs.nasa.gov/api/citations/20220005514/downloads/ASCE%20E%26S%202022%20SLOPE%20Update%20Presentation%20Final.pdf",
  },
  gravityOffset: {
    label: "Hu, Li, Rogg, Schepelmann y otros (2025), con NASA Ames y Glenn: las pruebas con robots aligerados engañan",
    url: "https://ntrs.nasa.gov/api/citations/20250001809/downloads/main-20250215.pdf",
  },
  lrvApollo15: {
    label: "Costes, Farmer y George (1972), NASA TR R-401: movilidad del carro lunar en el Apolo 15",
    url: "https://ntrs.nasa.gov/api/citations/19730008090/downloads/19730008090.pdf",
  },
  lunarSourcebook: {
    label: "Lunar Sourcebook (1991), cap. 9: tablas 9.13 (carro lunar) y 9.14 (parámetros del regolito)",
    url: "https://www.lpi.usra.edu/publications/books/lunar_sourcebook/pdf/Chapter09.pdf",
  },
  lrvNssdc: {
    label: "NASA NSSDC, Apollo Lunar Roving Vehicle",
    url: "https://nssdc.gsfc.nasa.gov/planetary/lunar/apollo_lrv.html",
  },
  wongTable: {
    label: "NASA TM-20250006958, tablas 1 y 2 (parámetros de Wong, 2001, y de Wong y Reece, 1967)",
    url: "https://ntrs.nasa.gov/api/citations/20250006958/downloads/TM-20250006958.pdf",
  },
  shearModulus: {
    label: "Agarwal y otros (2019), Journal of Terramechanics 85: K típico de 10 a 30 mm",
    url: "https://crablab.gatech.edu/pages/publications/pdf/Terramechanics-2019.pdf",
  },
  grc3: {
    label: "NASA (2020), simulante GRC-3: parámetros medidos con bevámetro (tabla 3)",
    url: "https://ntrs.nasa.gov/api/citations/20200003046/downloads/20200003046.pdf",
  },
  snowShape: {
    label: "Lines y otros (2021): c1 y c2 supuestos para nieve",
    url: "https://par.nsf.gov/servlets/purl/10304353",
  },
  curiositySlip: {
    label: "Rankin y otros (2021), Journal of Field Robotics 38: límites de patinaje de Curiosity",
    url: "https://www-robotics.jpl.nasa.gov/media/documents/ROB-20-0040_R3.pdf",
  },
  moonFacts: {
    label: "NASA NSSDC, Moon Fact Sheet: gravedad en la superficie 1,62 m/s²",
    url: "https://nssdc.gsfc.nasa.gov/planetary/factsheet/moonfact.html",
  },
  validity: {
    label: "Bekker y Wong, citados en Politecnico di Torino (2020), p. 24: hundimiento moderado, hasta r/3",
    url: "https://webthesis.biblio.polito.it/16627/1/tesi.pdf",
  },
  perseveranceRover: {
    label: "NASA, Perseverance Rover Components: 1025 kg, ruedas de 52,5 cm con 48 tacos, 152 m/h como máximo",
    url: "https://science.nasa.gov/mission/mars-2020-perseverance/rover-components/",
  },
  perseveranceModel: {
    label: "NASA/JPL-Caltech, modelo 3D oficial de Perseverance: ancho de rueda (33,6 cm) y posición de las ruedas, medidos en el modelo",
    url: "https://science.nasa.gov/resource/mars-perseverance-rover-3d-model/",
  },
  curiosityRover: {
    label: "NASA, Curiosity (MSL): 899 kg, del tamaño de un todoterreno pequeño",
    url: "https://science.nasa.gov/mission/msl-curiosity/",
  },
  curiosityWheels: {
    label: "NASA JPL (2017): cada rueda de Curiosity mide unos 50 cm de diámetro y 40 cm de ancho",
    url: "https://www.jpl.nasa.gov/news/breaks-observed-in-rover-wheel-treads/",
  },
  curiosityPressKit: {
    label: "NASA JPL, Mars Science Laboratory Landing Press Kit (2012), p. 38: 4 cm/s como máximo en suelo llano y duro",
    url: "https://www.jpl.nasa.gov/news/press_kits/MSLLanding.pdf",
  },
  curiosityModel: {
    label: "NASA/JPL-Caltech, modelo 3D oficial de Curiosity: posición de las ruedas, medida en el modelo",
    url: "https://science.nasa.gov/resource/curiosity-rover-3d-model/",
  },
} satisfies Record<string, Source>;

/**
 * Patinaje máximo aceptable: 40 %. Es el requisito de VIPER ("como máximo 40 % de patinaje en
 * una pendiente de 15°") y el límite que usa el equipo de Curiosity para dos pasos seguidos.
 */
export const SLIP_LIMIT = 0.4;

/** Constantes de Wong y Reece (1967) medidas en arenas. */
const SAND_SHAPE: StressShape = { c1: 0.285, c2: 0.32 };
const DRY_SAND_SHAPE: StressShape = { c1: 0.38, c2: 0.41 };
const LOOSE_SAND_SHAPE: StressShape = { c1: 0.18, c2: 0.32 };

export type VehicleId = "viper" | "lrv" | "perseverance" | "curiosity";

export interface VehiclePreset extends Vehicle {
  id: VehicleId;
  name: string;
  /** Para qué mundo se construyó. La comparación «Luna y aquí» solo tiene sentido con los lunares. */
  world: "luna" | "marte";
  /** Cómo se nombra dentro de una frase («VIPER sube…», «el carro lunar del Apolo sube…»). */
  subject: string;
  /** Para qué es y sus medidas, en una línea. */
  detail: string;
  notes: string[];
  sources: Source[];
  /** Velocidad de la rueda sin patinar, m/s, y de dónde sale. */
  wheelSpeed: number;
  speedNote: string;
  /** Batería, Wh, si está publicada. */
  batteryWh: number | null;
  /** Radio mínimo de giro en marcha, m; 0 si puede girar sobre sí mismo. */
  turnRadius: number;
  turnNote: string;
  /**
   * Medidas para dibujarlo en 3D, m. Largo, ancho y alto son los publicados; la distancia entre
   * ejes y entre ruedas, cuando no está publicada, es aproximada y no entra en el cálculo.
   */
  body: { length: number; width: number; height: number; wheelbase: number; track: number };
}

export const VEHICLES: readonly VehiclePreset[] = [
  {
    id: "viper",
    name: "VIPER",
    subject: "VIPER",
    mass: 447,
    wheels: 4,
    wheel: { radius: 0.25, width: 0.2 },
    detail: "Robot de NASA para el polo sur lunar · 447 kg · 4 ruedas de 50 × 20 cm",
    notes: [
      "Los 50 cm de diámetro llegan hasta la punta de sus 24 tacos de 26 mm; el cálculo trata la rueda como lisa.",
      "Requisito de NASA: subir 15° patinando como máximo un 40 %.",
    ],
    sources: [SOURCES.viperBriefing, SOURCES.viperWheel],
    wheelSpeed: 0.1,
    speedNote: "10 cm/s, su velocidad de prospección (NASA, 2025); la máxima es 20 cm/s",
    batteryWh: 5420,
    turnRadius: 0,
    turnNote: "Cada rueda se orienta por separado: gira sobre sí mismo",
    world: "luna",
    body: { length: 1.7, width: 1.7, height: 2.5, wheelbase: 1.2, track: 1.45 },
  },
  {
    id: "lrv",
    name: "Carro lunar del Apolo",
    subject: "el carro lunar del Apolo",
    mass: 708,
    wheels: 4,
    wheel: { radius: 0.409, width: 0.23 },
    detail: "Apolo 15, 16 y 17 · 708 kg con dos astronautas y carga · 4 ruedas de 81,8 × 23 cm",
    notes: ["Sus ruedas eran de malla de acero flexible; el cálculo las trata como rígidas."],
    sources: [SOURCES.lunarSourcebook, SOURCES.lrvNssdc],
    wheelSpeed: 1.8,
    speedNote: "6 a 7 km/h, su velocidad normal de crucero (Lunar Sourcebook); la máxima era unos 13 km/h",
    // Dos baterías de 36 V y 121 Ah (NASA NSSDC).
    batteryWh: 8712,
    turnRadius: 3.1,
    turnNote: "Dirección en los dos ejes: radio de giro de 3,1 m (NASA NSSDC)",
    world: "luna",
    body: { length: 3.1, width: 1.8, height: 1.14, wheelbase: 2.3, track: 1.8 },
  },
  {
    id: "perseverance",
    name: "Perseverance",
    subject: "Perseverance",
    mass: 1025,
    wheels: 6,
    wheel: { radius: 0.2625, width: 0.336 },
    detail: "Robot de NASA en el cráter Jezero de Marte · 1025 kg · 6 ruedas de 52,5 × 33,6 cm",
    notes: [
      "NASA publica el diámetro de la rueda (52,5 cm); el ancho (33,6 cm) está medido en su modelo 3D oficial.",
      "Sus 48 tacos curvos no entran en el cálculo: la rueda se trata como lisa.",
      "Es un robot para Marte: aquí se prueba con su masa real sobre el suelo y la gravedad de la Tierra.",
    ],
    sources: [SOURCES.perseveranceRover, SOURCES.perseveranceModel],
    wheelSpeed: 152 / 3600,
    speedNote: "4,2 cm/s (152 m/h), su velocidad máxima en suelo llano y duro (NASA)",
    batteryWh: null,
    turnRadius: 0,
    turnNote: "Cuatro ruedas directrices en las esquinas: gira sobre sí mismo",
    world: "marte",
    // Largo, ancho y alto publicados; ejes y vía, medidos en el modelo 3D oficial.
    body: { length: 3, width: 2.7, height: 2.2, wheelbase: 2.26, track: 2.12 },
  },
  {
    id: "curiosity",
    name: "Curiosity",
    subject: "Curiosity",
    mass: 899,
    wheels: 6,
    wheel: { radius: 0.25, width: 0.4 },
    detail: "Laboratorio de NASA en el cráter Gale de Marte · 899 kg · 6 ruedas de 50 × 40 cm",
    notes: [
      "Ruedas de aluminio de 50 cm de diámetro y 40 cm de ancho (NASA JPL); el cálculo las trata como lisas.",
      "Es un robot para Marte: aquí se prueba con su masa real sobre el suelo y la gravedad de la Tierra.",
    ],
    sources: [SOURCES.curiosityRover, SOURCES.curiosityWheels, SOURCES.curiosityPressKit, SOURCES.curiosityModel],
    wheelSpeed: 0.04,
    speedNote: "4 cm/s (144 m/h), su velocidad máxima en suelo llano y duro (NASA JPL, 2012)",
    batteryWh: null,
    turnRadius: 0,
    turnNote: "Cuatro ruedas directrices en las esquinas: gira sobre sí mismo",
    world: "marte",
    body: { length: 3, width: 2.7, height: 2.2, wheelbase: 2.26, track: 2.13 },
  },
];

/** Los vehículos hechos para la Luna: los únicos con los que se compara «Luna y aquí». */
export const LUNAR_VEHICLES: readonly VehiclePreset[] = VEHICLES.filter((vehicle) => vehicle.world === "luna");

export type SoilId =
  | "regolito"
  | "arena-seca"
  | "franco-arenoso"
  | "franco-arenoso-22"
  | "franco-arenoso-26"
  | "franco-arenoso-32"
  | "arcilloso"
  | "arcilloso-55"
  | "nieve"
  | "grc-3";

/** Clase de suelo: las filas de una misma clase solo se distinguen por su humedad. */
export type SoilFamily = "regolito" | "arena" | "franco-arenoso" | "arcilloso" | "nieve" | "simulante";

export interface SoilPreset {
  id: SoilId;
  name: string;
  detail: string;
  family: SoilFamily;
  /**
   * Humedad con la que se midió, en % del peso seco (la que da la tabla); null si la fuente no la
   * indica. Con ella se elige la fila que corresponde a la humedad del suelo de un día.
   */
  moisturePercent: number | null;
  soil: Soil;
  shape: StressShape;
  /** Lo que la fuente no da y se toma de la literatura. */
  assumed: string[];
  sources: Source[];
}

const K_TYPICAL = "K = 20 mm: valor típico de la literatura (10 a 30 mm), no medido para este suelo.";
const SHAPE_SAND = "c1 y c2 de arena (Wong y Reece, 1967): no se han medido para este suelo.";

/**
 * Regolito lunar: la estimación de Costes y otros (1972) a partir de las sondas Surveyor, que el
 * Lunar Sourcebook recomienda (tabla 9.14). Nadie ha medido estos parámetros en la Luna con un
 * bevámetro; el cálculo con ellos se comprueba contra el carro lunar del Apolo 15.
 */
export const MOON_SOIL: SoilPreset = {
  id: "regolito",
  name: "Regolito lunar",
  detail: "Estimación de las sondas Surveyor (Costes y otros, 1972), recomendada por el Lunar Sourcebook",
  family: "regolito",
  moisturePercent: null,
  soil: { n: 1, kc: 1400, kphi: 820_000, cohesion: 170, frictionDeg: 35, shearModulus: 0.018 },
  shape: SAND_SHAPE,
  assumed: [SHAPE_SAND, "Son estimaciones previas al Apolo: en la Luna nunca se midieron con un bevámetro."],
  sources: [SOURCES.lunarSourcebook, SOURCES.lrvApollo15, SOURCES.wongTable],
};

const WET_ROW =
  "Valores publicados para un suelo de esta clase con esa humedad (NASA TM-20250006958, tabla 1): no se midieron en este lugar.";

/**
 * Suelos de la Tierra con parámetros medidos y publicados (Wong, 2001), y el simulante de NASA.
 *
 * Las filas con humedad salen de la tabla 1 de NASA TM-20250006958 («Typical Bekker values for
 * various terrain types and moisture content»), leída del documento: kc en kN/m^(n+1), kφ en
 * kN/m^(n+2) y c en kPa, aquí pasados al SI. Del franco arenoso («Sandy Loam») la tabla trae seis
 * filas de tres suelos distintos; se usan las de 15, 22, 26 y 32 % de humedad, que cubren el rango
 * sin repetir humedades casi iguales (quedan fuera las de 11 y 23 %). La arena solo tiene la fila
 * seca: la tabla no trae arena húmeda.
 */
export const EARTH_SOILS: readonly SoilPreset[] = [
  {
    id: "arena-seca",
    name: "Arena seca",
    detail: "Arena suelta sin humedad (Wong, 2001)",
    family: "arena",
    moisturePercent: 0,
    soil: { n: 1.1, kc: 990, kphi: 1_528_430, cohesion: 1040, frictionDeg: 28, shearModulus: 0.02 },
    shape: DRY_SAND_SHAPE,
    assumed: [K_TYPICAL],
    sources: [SOURCES.wongTable, SOURCES.shearModulus],
  },
  {
    id: "franco-arenoso",
    name: "Franco arenoso",
    detail: "Suelo de arena con limo, 15 % de humedad (Wong, 2001)",
    family: "franco-arenoso",
    moisturePercent: 15,
    soil: { n: 0.7, kc: 5270, kphi: 1_515_040, cohesion: 1720, frictionDeg: 29, shearModulus: 0.02 },
    shape: SAND_SHAPE,
    assumed: [K_TYPICAL, SHAPE_SAND],
    sources: [SOURCES.wongTable, SOURCES.shearModulus],
  },
  {
    id: "franco-arenoso-22",
    name: "Franco arenoso, 22 % de humedad",
    detail: "Suelo de arena con limo, húmedo: 22 % de humedad (Wong, 2001)",
    family: "franco-arenoso",
    moisturePercent: 22,
    soil: { n: 0.2, kc: 2560, kphi: 43_120, cohesion: 1380, frictionDeg: 38, shearModulus: 0.02 },
    shape: SAND_SHAPE,
    assumed: [WET_ROW, K_TYPICAL, SHAPE_SAND],
    sources: [SOURCES.wongTable, SOURCES.shearModulus],
  },
  {
    id: "franco-arenoso-26",
    name: "Franco arenoso, 26 % de humedad",
    detail: "Suelo de arena con limo, muy húmedo: 26 % de humedad (Wong, 2001)",
    family: "franco-arenoso",
    moisturePercent: 26,
    soil: { n: 0.3, kc: 2790, kphi: 141_110, cohesion: 13_790, frictionDeg: 22, shearModulus: 0.02 },
    shape: SAND_SHAPE,
    assumed: [WET_ROW, K_TYPICAL, SHAPE_SAND],
    sources: [SOURCES.wongTable, SOURCES.shearModulus],
  },
  {
    id: "franco-arenoso-32",
    name: "Franco arenoso, 32 % de humedad",
    detail: "Suelo de arena con limo, embarrado: 32 % de humedad (Wong, 2001)",
    family: "franco-arenoso",
    moisturePercent: 32,
    soil: { n: 0.5, kc: 770, kphi: 51_910, cohesion: 5170, frictionDeg: 11, shearModulus: 0.02 },
    shape: SAND_SHAPE,
    assumed: [WET_ROW, K_TYPICAL, SHAPE_SAND],
    sources: [SOURCES.wongTable, SOURCES.shearModulus],
  },
  {
    id: "arcilloso",
    name: "Suelo arcilloso",
    detail: "Suelo con arcilla, 38 % de humedad (Wong, 2001)",
    family: "arcilloso",
    moisturePercent: 38,
    soil: { n: 0.5, kc: 13_190, kphi: 692_150, cohesion: 4140, frictionDeg: 13, shearModulus: 0.02 },
    shape: SAND_SHAPE,
    assumed: [K_TYPICAL, SHAPE_SAND],
    sources: [SOURCES.wongTable, SOURCES.shearModulus],
  },
  {
    id: "arcilloso-55",
    name: "Suelo arcilloso, 55 % de humedad",
    detail: "Suelo con arcilla, embarrado: 55 % de humedad (Wong, 2001)",
    family: "arcilloso",
    moisturePercent: 55,
    soil: { n: 0.7, kc: 16_030, kphi: 1_262_530, cohesion: 2070, frictionDeg: 10, shearModulus: 0.02 },
    shape: SAND_SHAPE,
    assumed: [WET_ROW, K_TYPICAL, SHAPE_SAND],
    sources: [SOURCES.wongTable, SOURCES.shearModulus],
  },
  {
    id: "nieve",
    name: "Nieve",
    detail: "Nieve (Wong, 2001)",
    family: "nieve",
    moisturePercent: null,
    soil: { n: 1.6, kc: 4370, kphi: 196_720, cohesion: 1030, frictionDeg: 19.7, shearModulus: 0.02 },
    shape: LOOSE_SAND_SHAPE,
    assumed: [K_TYPICAL, "c1 y c2 supuestos para nieve (Lines y otros, 2021): no hay ensayos de rueda que los midan."],
    sources: [SOURCES.wongTable, SOURCES.snowShape],
  },
  {
    // La tabla de NASA rotula las unidades de kc y kφ al revés; con n = 1 los valores son los de
    // la convención de Bekker (kc en kN/m², kφ en kN/m³), los únicos dimensionalmente coherentes.
    id: "grc-3",
    name: "Simulante lunar GRC-3",
    detail: "Suelo de ensayo de NASA, suelto, medido con bevámetro (2020)",
    family: "simulante",
    moisturePercent: null,
    soil: { n: 1, kc: 23_200, kphi: 606_700, cohesion: 130, frictionDeg: 36.7, shearModulus: 0.0235 },
    shape: SAND_SHAPE,
    assumed: [SHAPE_SAND],
    sources: [SOURCES.grc3],
  },
];

export const soilById = (id: SoilId): SoilPreset =>
  id === "regolito" ? MOON_SOIL : (EARTH_SOILS.find((soil) => soil.id === id) ?? EARTH_SOILS[0]);

export const vehicleById = (id: VehicleId): VehiclePreset => VEHICLES.find((v) => v.id === id) ?? VEHICLES[0];

/** Textura del suelo superficial según el mapa mundial SoilGrids (predicción, no medición). */
export interface Texture {
  sand: number;
  silt: number;
  clay: number;
  bulkDensity: number;
}

export interface SoilSuggestion {
  id: SoilId;
  /** false si el mapa no tiene dato y se deja el suelo por defecto. */
  fromMap: boolean;
}

/**
 * Suelo de la lista que corresponde a una textura, con una regla simple del triángulo de texturas:
 * 70 % de arena o más → arena (arena y arena franca); 35 % de arcilla o más → arcilloso; el
 * resto → franco arenoso. Sin dato (glaciar, roca, agua) → arena seca, marcada como no sugerida.
 */
export function suggestSoil(texture: Texture | null | undefined): SoilSuggestion {
  if (!texture) return { id: "arena-seca", fromMap: false };
  if (texture.sand >= 70) return { id: "arena-seca", fromMap: true };
  if (texture.clay >= 35) return { id: "arcilloso", fromMap: true };
  return { id: "franco-arenoso", fromMap: true };
}

/** Densidad aparente que se supone cuando el mapa no la da, en g/cm³: la de un suelo mineral común. */
export const DEFAULT_BULK_DENSITY = 1.3;

/**
 * Humedad del suelo como la dan las tablas de rueda y suelo: gramos de agua por cada 100 g de
 * suelo seco. Los modelos del tiempo la dan en volumen (m³ de agua por m³ de suelo); se pasa de
 * una a otra con la densidad aparente del suelo (g/cm³): peso = volumen / densidad.
 */
export function gravimetricPercent(volumetric: number, bulkDensity: number = DEFAULT_BULK_DENSITY): number {
  return (volumetric / bulkDensity) * 100;
}

/**
 * La fila publicada de una clase de suelo que más se acerca a una humedad (% del peso seco).
 * Una clase con una sola fila, o sin humedad publicada (arena, nieve, simulante), devuelve esa.
 * `among` limita la búsqueda a unas filas de la clase.
 */
export function soilForMoisture(
  family: SoilFamily,
  moisturePercent: number,
  among: readonly SoilPreset[] = EARTH_SOILS,
): SoilPreset {
  const rows = among.filter((soil) => soil.family === family && soil.moisturePercent !== null);
  if (!rows.length) return EARTH_SOILS.find((soil) => soil.family === family) ?? EARTH_SOILS[0];
  return rows.reduce((best, row) =>
    Math.abs(row.moisturePercent! - moisturePercent) < Math.abs(best.moisturePercent! - moisturePercent) ? row : best,
  );
}

/** true si la clase tiene filas para más de una humedad: solo entonces la humedad del día cambia el cálculo. */
export const respondsToMoisture = (family: SoilFamily): boolean =>
  EARTH_SOILS.filter((soil) => soil.family === family && soil.moisturePercent !== null).length > 1;

/** Mediciones reales con las que se comprueba el cálculo. */
export const REFERENCES = {
  /** Carro lunar del Apolo 15, en la Luna. */
  apollo15: {
    sinkageCm: 1.25,
    sinkageNote: "hasta 5 a 7 cm en bordes de cráteres pequeños",
    slipPercent: [2, 3] as const,
    maxSlopeDeg: [19, 23] as const,
    sources: [SOURCES.lrvApollo15, SOURCES.lunarSourcebook],
  },
  /**
   * Versión aligerada de VIPER (aprox. 1/6 de su masa) en el laboratorio SLOPE de NASA Glenn, en
   * simulante GRC-1 suelto y con gravedad terrestre. Valores leídos de la gráfica de NASA.
   */
  slopeLab: {
    mass: 447 / 6,
    slipBySlope: [
      { slope: 10, slip: 9 },
      { slope: 15, slip: 18 },
      { slope: 20, slip: 40 },
      { slope: 25, slip: 70 },
    ],
    /** Pendiente a la que llegó con un 40 % de patinaje. */
    slopeAtLimit: 20,
    /** El GRC-1 no tiene parámetros de Bekker fiables publicados: se calcula con el GRC-3. */
    soil: "grc-3" as SoilId,
    sources: [SOURCES.slopeLab],
  },
} as const;
