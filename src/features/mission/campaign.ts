/**
 * Ventanas de campaña por trimestre y el plan que se descarga.
 *
 * El estado de cada trimestre sale del clima típico real del lugar (ver `world/climate.ts`).
 * El plan es un documento de planificación: no reserva nada con nadie ni equivale a un permiso.
 */
import { MONTHS } from "../world/climate";
import type { MonthProfile } from "../world/climate";
import { similarity } from "../world/hierarchy";
import { usd as money } from "./cost";
import type { CampaignCost } from "./cost";

export type WindowStatus = "optima" | "exigente" | "restringida";

export const WINDOW_STATUS: Record<WindowStatus, { name: string; symbol: string; detail: string; factor: number }> = {
  optima: { name: "Óptima", symbol: "✓", detail: "Clima favorable para trabajar en el terreno.", factor: 1 },
  exigente: {
    name: "Exigente",
    symbol: "~",
    detail: "Se puede trabajar con más preparación. Útil para pruebas de estrés del equipo.",
    factor: 1.25,
  },
  restringida: {
    name: "Restringida",
    symbol: "✕",
    detail: "Clima difícil la mayor parte del periodo.",
    factor: 1.6,
  },
};

export interface Quarter {
  /** 0 = enero a marzo. */
  index: number;
  name: string;
  months: MonthProfile[];
  status: WindowStatus;
  /** Inconvenientes que aparecen en el trimestre, sin repetir. */
  reasons: string[];
  temperatureMin: number;
  temperatureMax: number;
  /** mm acumulados en los tres meses. */
  precipitation: number;
}

const short = (month: number) => MONTHS[month][0].toUpperCase() + MONTHS[month].slice(1, 3);

/** Los cuatro trimestres del año con su estado. */
export function quarters(year: readonly MonthProfile[]): Quarter[] {
  return [0, 1, 2, 3].map((index) => {
    const months = year.slice(index * 3, index * 3 + 3);
    const difficult = months.filter((m) => m.rating === "dificil").length;
    const favorable = months.filter((m) => m.rating === "favorable").length;
    const status: WindowStatus = difficult >= 2 ? "restringida" : favorable >= 2 && difficult === 0 ? "optima" : "exigente";
    return {
      index,
      name: `${short(index * 3)}–${short(index * 3 + 2)}`,
      months,
      status,
      reasons: [...new Set(months.flatMap((m) => m.reasons))],
      temperatureMin: Math.min(...months.map((m) => m.temperatureMin)),
      temperatureMax: Math.max(...months.map((m) => m.temperatureMax)),
      precipitation: months.reduce((sum, m) => sum + m.precipitation, 0),
    };
  });
}

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** Código del plan: «ANALOG-2026-X94K». Identifica el documento; no es una reserva. */
export function missionCode(year: number, random: () => number = Math.random): string {
  const tail = Array.from({ length: 4 }, () => CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)]).join("");
  return `ANALOG-${year}-${tail}`;
}

/** Recorrido de prueba del robot en el gemelo 3D del lugar (simulación antes de viajar). */
export interface RobotTestResult {
  vehicle: string;
  soil: string;
  start: { latitude: number; longitude: number };
  end: { latitude: number; longitude: number };
  outcome: "llego" | "atascado";
  distanceM: number;
  timeS: number;
  energyWh: number;
  maxSlopeDeg: number;
  maxSlipPercent: number;
  /** Cómo se condujo: con los mandos, con el piloto automático (un clic en el terreno) o con los dos. */
  mode?: "manual" | "piloto" | "mixto";
  /** false si la prueba se terminó a mano, sin llegar a un destino marcado. */
  reachedTarget?: boolean;
  /** Topes con las rocas y la base de práctica del simulador, y veces que se quedó atascado. */
  collisions?: number;
  stuckTimes?: number;
}

const DRIVE_MODES: Record<NonNullable<RobotTestResult["mode"]>, string> = {
  manual: "con los mandos",
  piloto: "con el piloto automático",
  mixto: "con los mandos y el piloto automático",
};

/** Cómo terminó la prueba, en pocas palabras: «llegó al destino», «se atascó» o «recorrido libre, sin atascarse». */
export const robotOutcome = (test: RobotTestResult) =>
  test.outcome === "atascado" ? "se atascó" : test.reachedTarget === false ? "recorrido libre, sin atascarse" : "llegó al destino";

/** El resultado con su distancia: «se atascó tras 152,3 m», «recorrido libre, sin atascarse, tras 39 m». */
export function robotOutcomeAfter(test: RobotTestResult, distance: string): string {
  const outcome = robotOutcome(test);
  return `${outcome}${outcome.includes(",") ? "," : ""} tras ${distance}`;
}

export interface MissionPlan {
  code: string;
  generatedAt: string;
  mission: string;
  institution: string;
  site: { name: string; province: string; country: string; latitude: number; longitude: number };
  /** Con qué se comparó el terreno y a qué distancia quedó. */
  reference: { name: string; world: string; distance: number; real: boolean };
  window: { year: number; quarter: string; status: string; reasons: string[] } | null;
  team: { origin: string; distanceKm: number; people: number; cargoKg: number; days: number };
  cost: CampaignCost;
  /** La prueba del robot, si se hizo y se añadió al plan. */
  robotTest: RobotTestResult | null;
  notes: string[];
}

export const PLAN_NOTES = [
  "Documento de planificación generado por PROMETHEUS. No es una reserva, un permiso ni una cotización.",
  "Los costos usan tarifas de ejemplo. Antes de comprometer fondos hacen falta cotizaciones y permisos reales.",
  "El estado de la temporada sale del clima típico (NASA POWER, 2001–2025), no de un pronóstico.",
  "La comparación con la Luna cubre solo la forma del terreno.",
];

/** El plan en texto, para guardar o enviar. */
export function planText(plan: MissionPlan): string {
  const lines = [
    "PROMETHEUS · PLAN DE CAMPAÑA ANÁLOGA",
    `Código: ${plan.code}`,
    `Generado: ${plan.generatedAt}`,
    "",
    `Misión: ${plan.mission}`,
    `Institución: ${plan.institution}`,
    "",
    "SITIO",
    `  ${plan.site.name} (${plan.site.province}, ${plan.site.country})`,
    `  Coordenadas: ${plan.site.latitude}, ${plan.site.longitude}`,
    `  Referencia: ${plan.reference.name} (${plan.reference.world}), ${similarity(plan.reference.distance).text.toLowerCase()} de terreno (distancia ${plan.reference.distance.toFixed(3)})${plan.reference.real ? "" : " (demostración)"}`,
    "",
    "VENTANA",
    plan.window
      ? `  ${plan.window.quarter} de ${plan.window.year}: ${plan.window.status}${plan.window.reasons.length ? ` (${plan.window.reasons.join(", ")})` : ""}`
      : "  Sin clima típico calculado para este lugar.",
    "",
    "EQUIPO",
    `  Salida: ${plan.team.origin} (${Math.round(plan.team.distanceKm)} km)`,
    `  Personas: ${plan.team.people}   Carga: ${plan.team.cargoKg} kg   Días en campo: ${plan.team.days}`,
    "",
    "COSTO ESTIMADO (tarifas de ejemplo)",
    `  Pasajes, ida y vuelta:        ${money(plan.cost.flights)}`,
    `  Carga, ida y vuelta:          ${money(plan.cost.cargo)}`,
    `  Trabajo de campo:             ${money(plan.cost.field)}`,
    `  Permisos y seguros:           ${money(plan.cost.permits)}`,
    `  Imprevistos:                  ${money(plan.cost.contingency)}`,
    `  TOTAL:                        ${money(plan.cost.total)}`,
    `  Por día de ensayo:            ${money(plan.cost.perDay)}`,
    "",
    "PRUEBA DEL ROBOT (simulación antes de viajar)",
    ...(plan.robotTest
      ? [
          `  Robot: ${plan.robotTest.vehicle}   Suelo supuesto: ${plan.robotTest.soil}`,
          `  Inicio: ${plan.robotTest.start.latitude}, ${plan.robotTest.start.longitude}`,
          `  Final:  ${plan.robotTest.end.latitude}, ${plan.robotTest.end.longitude}`,
          `  Resultado: ${robotOutcomeAfter(plan.robotTest, `${plan.robotTest.distanceM} m`)} (${Math.round(plan.robotTest.timeS / 60)} min a velocidad real)`,
          ...(plan.robotTest.mode
            ? [
                `  Conducción: ${DRIVE_MODES[plan.robotTest.mode]}; ${plan.robotTest.collisions ?? 0} topes con obstáculos de práctica y ${plan.robotTest.stuckTimes ?? 0} atascos`,
              ]
            : []),
          `  Pendiente máxima ${plan.robotTest.maxSlopeDeg}°, patinaje máximo ${plan.robotTest.maxSlipPercent} %, energía ${plan.robotTest.energyWh} Wh`,
        ]
      : ["  No se hizo la prueba del robot."]),
    "",
    "NOTAS",
    ...plan.notes.map((note) => `  - ${note}`),
  ];
  return `${lines.join("\n")}\n`;
}
