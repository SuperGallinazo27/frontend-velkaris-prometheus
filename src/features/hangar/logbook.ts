/**
 * Bitácora de pruebas: cada prueba que se termina en el simulador queda anotada con el robot, el
 * lugar y lo que pasó (cuánto recorrió, cuánto patinó, si se atascó). El hangar la usa para
 * enseñar, robot por robot, en qué lugares se ha probado.
 *
 * Se guarda en este navegador, separada por cuenta: no sale del equipo ni la ven otras agencias.
 * Son resultados del simulador (un modelo), no de pruebas de campo.
 */

export interface LogEntry {
  id: string;
  /** Cuándo terminó la prueba, en ISO. */
  at: string;
  /** Robot del catálogo: «perseverance», «viper»… */
  robot: string;
  siteId: string;
  siteName: string;
  soil: string;
  outcome: "llego" | "atascado";
  reachedTarget: boolean;
  distanceM: number;
  timeS: number;
  energyWh: number;
  maxSlopeDeg: number;
  maxSlipPercent: number;
  collisions: number;
  stuckTimes: number;
  mode: "manual" | "piloto" | "mixto";
  /** true si se condujo con gestos de la mano ante la cámara. */
  gestures: boolean;
}

export type NewLogEntry = Omit<LogEntry, "id">;

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const PREFIX = "prometheus.bitacora.";
/** Las pruebas más antiguas se sueltan al pasar de este número. */
export const LOG_LIMIT = 200;

const keyOf = (account: string) => PREFIX + account.trim().toLowerCase();

function browserStore(): Store | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

function isEntry(value: unknown): value is LogEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.id === "string" &&
    typeof entry.at === "string" &&
    typeof entry.robot === "string" &&
    typeof entry.siteId === "string" &&
    typeof entry.siteName === "string" &&
    (entry.outcome === "llego" || entry.outcome === "atascado") &&
    isNumber(entry.distanceM) &&
    isNumber(entry.timeS) &&
    isNumber(entry.energyWh) &&
    isNumber(entry.maxSlopeDeg) &&
    isNumber(entry.maxSlipPercent)
  );
}

/** Las pruebas de una cuenta, de la más reciente a la más antigua. Lo que no se entiende se descarta. */
export function readLog(account: string, store: Store | null = browserStore()): LogEntry[] {
  if (!store || !account) return [];
  try {
    const parsed: unknown = JSON.parse(store.getItem(keyOf(account)) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isEntry).sort((a, b) => b.at.localeCompare(a.at));
  } catch {
    return [];
  }
}

/**
 * Anota una prueba y devuelve su identificador. Con `replace` sustituye la anotación anterior de la
 * misma prueba: pasa cuando, tras un resultado, se sigue conduciendo y se termina otra vez (los
 * metros y el tiempo son acumulados; anotarla dos veces los contaría doble).
 * Sin almacenamiento no se guarda y no falla: devuelve null.
 */
export function saveLogEntry(
  account: string,
  entry: NewLogEntry,
  replace: string | null = null,
  store: Store | null = browserStore(),
): string | null {
  if (!store || !account) return null;
  const id = replace ?? `${entry.at}-${Math.random().toString(36).slice(2, 8)}`;
  const others = readLog(account, store).filter((other) => other.id !== id);
  const next = [{ ...entry, id }, ...others].slice(0, LOG_LIMIT);
  try {
    store.setItem(keyOf(account), JSON.stringify(next));
    return id;
  } catch {
    // Almacenamiento lleno o bloqueado: la prueba sigue valiendo en pantalla, solo no queda anotada.
    return null;
  }
}

export function clearLog(account: string, store: Store | null = browserStore()): void {
  try {
    store?.removeItem(keyOf(account));
  } catch {
    // Nada que borrar.
  }
}

export interface LogSummary {
  runs: number;
  /** Lugares distintos en los que se probó. */
  places: number;
  distanceM: number;
  energyWh: number;
  /** Pruebas que terminaron con el robot atascado. */
  stuckRuns: number;
  collisions: number;
  /** La prueba con más patinaje y la de mayor pendiente: dónde fueron. */
  worstSlip: { percent: number; siteName: string };
  steepest: { degrees: number; siteName: string };
  gestureRuns: number;
}

/** Resumen de un conjunto de pruebas; null si no hay ninguna. */
export function summarize(entries: readonly LogEntry[]): LogSummary | null {
  if (entries.length === 0) return null;
  const worst = entries.reduce((a, b) => (b.maxSlipPercent > a.maxSlipPercent ? b : a));
  const steep = entries.reduce((a, b) => (b.maxSlopeDeg > a.maxSlopeDeg ? b : a));
  return {
    runs: entries.length,
    places: new Set(entries.map((entry) => entry.siteId)).size,
    distanceM: Math.round(entries.reduce((sum, entry) => sum + entry.distanceM, 0) * 10) / 10,
    energyWh: Math.round(entries.reduce((sum, entry) => sum + entry.energyWh, 0) * 10) / 10,
    stuckRuns: entries.filter((entry) => entry.outcome === "atascado").length,
    collisions: entries.reduce((sum, entry) => sum + (entry.collisions ?? 0), 0),
    worstSlip: { percent: worst.maxSlipPercent, siteName: worst.siteName },
    steepest: { degrees: steep.maxSlopeDeg, siteName: steep.siteName },
    gestureRuns: entries.filter((entry) => entry.gestures).length,
  };
}

// ---------- Robot elegido en el hangar ----------

const ROBOT_KEY = "prometheus.robot";

/** El robot que se pidió usar en el simulador desde el hangar, o null. */
export function preferredRobot(store: Store | null = browserStore()): string | null {
  try {
    return store?.getItem(ROBOT_KEY) ?? null;
  } catch {
    return null;
  }
}

export function setPreferredRobot(robot: string, store: Store | null = browserStore()): void {
  try {
    store?.setItem(ROBOT_KEY, robot);
  } catch {
    // Sin almacenamiento, el simulador abre con su robot de siempre.
  }
}
