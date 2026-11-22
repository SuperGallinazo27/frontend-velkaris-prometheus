/**
 * Datos del hangar: de qué está hecho cada robot, en qué otras misiones voló cada pieza («herencia
 * de vuelo») y su historial de misiones. Todo sale de páginas de NASA, JPL, NSSDC, ESA, el
 * Smithsonian y artículos científicos; cada dato lleva su fuente, y la cita textual que lo
 * respalda está en `scripts/hangar/investigacion/`. Lo que no se pudo comprobar no está.
 */
import data from "../../data/hangar.json";

export interface SourceRef {
  title: string;
  url: string;
}

export interface PartFact {
  label: string;
  value: string;
  source: SourceRef;
}

/** Otra misión en la que voló (o volará) la misma pieza, su diseño o su tecnología. */
export interface PartHeritage {
  mission: string;
  /** Año de lanzamiento; si es futuro, es el previsto. */
  year: number;
  note: string;
  source: SourceRef;
}

export interface PartInfo {
  name: string;
  what: string;
  facts: PartFact[];
  heritage: PartHeritage[];
}

export interface Milestone {
  /** «2021-02-18» o, si la fuente solo da el mes, «2024-08». */
  date: string;
  text: string;
  source: SourceRef;
}

export interface MissionInfo {
  name: string;
  agency: string;
  /** Lanzamiento; null si todavía no ha volado. */
  start: string | null;
  /** Fin de la misión; null si sigue en curso o no ha empezado. */
  end: string | null;
  where: string;
  summary: string;
  milestones: Milestone[];
  source: SourceRef;
}

export interface HangarRobot {
  components: Record<string, PartInfo>;
  missions: MissionInfo[];
}

const robots = data.robots as Record<string, HangarRobot>;

export const hangarOf = (robotId: string): HangarRobot | null => robots[robotId] ?? null;

/** Día en que se comprobaron las fuentes. */
export const HANGAR_CHECKED: string = data.checked;

const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

/** «18 de febrero de 2021» a partir de «2021-02-18»; «agosto de 2024» a partir de «2024-08». */
export function dateText(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  if (!year) return iso;
  if (!month) return String(year);
  const name = MONTHS[month - 1] ?? "";
  return day ? `${day} de ${name} de ${year}` : `${name} de ${year}`;
}

/** Cuándo voló la misión, en una frase. */
export function periodText(mission: MissionInfo): string {
  if (mission.start && mission.end) return `Del ${dateText(mission.start)} al ${dateText(mission.end)}`;
  if (mission.start) return `Lanzada el ${dateText(mission.start)} · sigue en curso`;
  return "Todavía no ha volado";
}

/** true si la herencia es de una misión que aún no ha salido (su año es el previsto). */
export const isPlanned = (entry: PartHeritage, today: Date = new Date()) => entry.year > today.getFullYear();
