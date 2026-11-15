/**
 * Lo que muestra la pestaña «Ruedas»: el mismo vehículo en la región lunar y en el lugar de la
 * Tierra, cada uno con su suelo y su gravedad, y la comprobación del cálculo contra mediciones
 * reales. Son funciones puras: la pantalla las ejecuta en un worker para no trabarse.
 */
import type { SlipTable } from "./drive";
import { climb, maxSlope, slipCurve } from "./terramechanics";
import type { Climb } from "./terramechanics";
import { EARTH_GRAVITY, MOON_GRAVITY, MOON_SOIL, REFERENCES, SLIP_LIMIT, soilById, vehicleById } from "./wheelData";
import type { SoilId, SoilPreset, VehicleId } from "./wheelData";

/** Pendientes de la gráfica, en grados. */
export const CURVE_SLOPES: readonly number[] = Array.from({ length: 16 }, (_, k) => k * 2);

export interface WheelRequest {
  vehicle: VehicleId;
  earthSoil: SoilId;
  /** Pendiente típica de la región lunar, en grados. */
  moonSlope: number;
  /** Pendiente típica del lugar de la Tierra, en grados. */
  earthSlope: number;
}

export interface WorldResult {
  curve: Climb[];
  /** En llano. */
  flat: Climb;
  /** En la pendiente típica del lugar. */
  typical: Climb;
  /** Pendiente más fuerte con un patinaje de SLIP_LIMIT o menos. */
  maxSlope: number;
}

export interface WheelResult {
  moon: WorldResult;
  earth: WorldResult;
}

function side(request: WheelRequest, preset: SoilPreset, gravity: number, slope: number): WorldResult {
  const vehicle = vehicleById(request.vehicle);
  return {
    curve: slipCurve(vehicle, preset.soil, gravity, CURVE_SLOPES, preset.shape),
    flat: climb(vehicle, preset.soil, gravity, 0, preset.shape),
    typical: climb(vehicle, preset.soil, gravity, slope, preset.shape),
    maxSlope: maxSlope(vehicle, preset.soil, gravity, SLIP_LIMIT, preset.shape),
  };
}

export function computeWheels(request: WheelRequest): WheelResult {
  return {
    moon: side(request, MOON_SOIL, MOON_GRAVITY, request.moonSlope),
    earth: side(request, soilById(request.earthSoil), EARTH_GRAVITY, request.earthSlope),
  };
}

export interface Validation {
  /** El carro lunar en el regolito con gravedad lunar, para compararlo con el Apolo 15. */
  apollo15: { sinkageCm: number; slipPercent: number; maxSlopeDeg: number };
  /** La versión aligerada de VIPER en el simulante y con gravedad terrestre, como en el SLOPE. */
  slopeLab: { slopeAtLimit: number };
}

export function computeValidation(): Validation {
  const lrv = vehicleById("lrv");
  const flat = climb(lrv, MOON_SOIL.soil, MOON_GRAVITY, 0, MOON_SOIL.shape);
  const light = { ...vehicleById("viper"), mass: REFERENCES.slopeLab.mass };
  const simulant = soilById(REFERENCES.slopeLab.soil);
  return {
    apollo15: {
      sinkageCm: (flat.sinkage ?? Number.NaN) * 100,
      slipPercent: (flat.slip ?? Number.NaN) * 100,
      maxSlopeDeg: maxSlope(lrv, MOON_SOIL.soil, MOON_GRAVITY, SLIP_LIMIT, MOON_SOIL.shape),
    },
    slopeLab: { slopeAtLimit: maxSlope(light, simulant.soil, EARTH_GRAVITY, SLIP_LIMIT, simulant.shape) },
  };
}

/** Paso y límite de la tabla de pendientes que usa el recorrido de prueba, en grados. */
export const TABLE_STEP = 0.5;
export const TABLE_MAX = 40;
const TABLE_SLOPES = Array.from({ length: TABLE_MAX / TABLE_STEP + 1 }, (_, k) => k * TABLE_STEP);

/**
 * Tabla de patinaje por pendiente para el recorrido: termina en la primera pendiente en la que ya
 * no avanza (más empinado, tampoco).
 */
function table(request: Pick<WheelRequest, "vehicle">, preset: SoilPreset, gravity: number): SlipTable {
  const vehicle = vehicleById(request.vehicle);
  const climbs: Climb[] = [];
  for (const slope of TABLE_SLOPES) {
    const result = climb(vehicle, preset.soil, gravity, slope, preset.shape);
    climbs.push(result);
    if (result.outcome !== "avanza") break;
  }
  return { slopes: TABLE_SLOPES.slice(0, climbs.length), climbs };
}

/** Las tablas del lugar (su suelo, gravedad terrestre) y de la Luna (regolito, gravedad lunar). */
export function slipTables(vehicle: VehicleId, earthSoil: SoilId): { earth: SlipTable; moon: SlipTable } {
  return {
    earth: table({ vehicle }, soilById(earthSoil), EARTH_GRAVITY),
    moon: table({ vehicle }, MOON_SOIL, MOON_GRAVITY),
  };
}

/** Pendiente desde la que se patina más de `limit` y desde la que ya no avanza, según la tabla. */
export function tableLimits(slipTable: SlipTable, limit: number): { steep: number; stuck: number } {
  const steep = slipTable.climbs.find((c) => c.outcome !== "avanza" || c.slip! > limit);
  const stuck = slipTable.climbs.find((c) => c.outcome !== "avanza");
  const last = slipTable.slopes.at(-1) ?? 0;
  return { steep: steep ? steep.slopeDeg : last, stuck: stuck ? stuck.slopeDeg : last + TABLE_STEP };
}

/** Cómo se compara la pendiente máxima de aquí con la de la Luna, para decirlo en una frase. */
export type Comparison = "parecido" | "mas-dificil" | "mas-facil";

/** Diferencia (grados) por debajo de la cual se dice que suben «casi lo mismo». */
export const SIMILAR_SLOPE_DEG = 2;

export function compare(result: WheelResult): { kind: Comparison; difference: number } {
  const difference = result.earth.maxSlope - result.moon.maxSlope;
  if (Math.abs(difference) < SIMILAR_SLOPE_DEG) return { kind: "parecido", difference };
  return { kind: difference < 0 ? "mas-dificil" : "mas-facil", difference };
}

// ---------- Pronóstico de rodadura ----------

/** Lo que da el modelo para un suelo de la Tierra, en lo que importa a un día del pronóstico. */
export interface DriveOutlook {
  soil: SoilId;
  /** En llano: de aquí sale el hundimiento. */
  flat: Climb;
  /** En la pendiente típica del lugar. */
  typical: Climb;
  /** Pendiente más fuerte con un patinaje de SLIP_LIMIT o menos. */
  maxSlope: number;
}

/** El robot en cada suelo de la lista, con la gravedad de la Tierra. Un suelo repetido se calcula una vez. */
export function computeOutlooks(vehicle: VehicleId, soils: readonly SoilId[], slope: number): DriveOutlook[] {
  const chosen = vehicleById(vehicle);
  return [...new Set(soils)].map((id) => {
    const preset = soilById(id);
    return {
      soil: id,
      flat: climb(chosen, preset.soil, EARTH_GRAVITY, 0, preset.shape),
      typical: climb(chosen, preset.soil, EARTH_GRAVITY, slope, preset.shape),
      maxSlope: maxSlope(chosen, preset.soil, EARTH_GRAVITY, SLIP_LIMIT, preset.shape),
    };
  });
}

/** Qué le pasa al robot ese día en la pendiente típica del lugar. */
export type DriveVerdict = "bien" | "cuidado" | "atasca";

export const DRIVE_VERDICTS: Record<DriveVerdict, { name: string; symbol: string }> = {
  bien: { name: "Rueda bien", symbol: "✓" },
  cuidado: { name: "Con cuidado", symbol: "~" },
  atasca: { name: "Se atasca", symbol: "✕" },
};

/**
 * - «Se atasca»: en la pendiente típica ya no avanza.
 * - «Con cuidado»: avanza, pero patinando más del límite, o hundiéndose tanto (más de un tercio
 *   del radio) que el modelo pierde precisión.
 * - «Rueda bien»: avanza con el patinaje dentro del límite.
 */
export function driveVerdict(outlook: DriveOutlook, limit: number = SLIP_LIMIT): DriveVerdict {
  if (outlook.typical.outcome !== "avanza") return "atasca";
  if (outlook.typical.slip! > limit || !outlook.typical.reliable || !outlook.flat.reliable) return "cuidado";
  return "bien";
}
