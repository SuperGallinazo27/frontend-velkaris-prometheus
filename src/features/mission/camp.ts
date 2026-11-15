/**
 * Campo de práctica del simulador: una base de campaña, rocas y matas de vegetación alrededor del
 * punto de partida.
 *
 * El relieve disponible tiene un dato cada 30 m y la imagen satelital uno cada 10 m: ninguno ve
 * rocas, matas ni un campamento. Por eso:
 * - **La base** es de ejemplo: da escala y sirve para maniobrar.
 * - **Cuántas rocas hay y de qué tamaño** sale, cuando existe, de la lectura de fotos del lugar
 *   (`terrainReading.ts`): una estimación en clases amplias. Sin lectura, son rocas de práctica.
 * - **Dónde está cada roca** es siempre al azar.
 *
 * Este módulo solo decide dónde va cada cosa (funciones puras, con un azar repetible); los dibuja
 * `robotScene.ts` con `campModels.ts`.
 */
import type { RockCover, RockSize, TerrainReading, Vegetation } from "../world/terrainReading";
import { slopeAlong } from "./drive";
import type { HeightAt, Obstacle } from "./drive";

export type CampKind = "habitat" | "domo" | "antena" | "paneles" | "cajas" | "deposito" | "bandera";

export interface CampItem {
  kind: CampKind;
  east: number;
  north: number;
  /** Hacia dónde mira, rad desde el este hacia el norte. */
  heading: number;
  /** Radio del círculo con el que choca el robot, m; 0 si no estorba. */
  radius: number;
}

export interface Rock {
  east: number;
  north: number;
  /** Ancho aproximado, m. */
  size: number;
  /** Giro y forma, para que no sean todas iguales. */
  turn: number;
  variant: number;
  /** Las de medio metro o más detienen al robot; las menores son grava que se pisa. */
  solid: boolean;
}

/** Una mata de vegetación baja: no estorba al robot. */
export interface Tuft {
  east: number;
  north: number;
  /** Alto aproximado, m. */
  size: number;
  turn: number;
}

/** Cuántas rocas y matas se reparten, y de qué tamaño. */
export interface RockField {
  /** Rocas que detienen al robot y su rango de tamaño, m. */
  solid: number;
  solidSize: readonly [number, number];
  /** Piedras que se pisan: cantidad y rango de tamaño, m. */
  pebbles: number;
  pebbleSize: readonly [number, number];
  /** Matas de vegetación baja. */
  tufts: number;
  /** true si las rocas salen de la lectura de fotos; false si son de práctica. */
  fromReading: boolean;
}

export interface CampLayout {
  /** Centro de la base y rumbo de su eje. */
  base: { east: number; north: number; heading: number };
  items: CampItem[];
  rocks: Rock[];
  tufts: Tuft[];
  /** Todo lo que detiene al robot: módulos de la base y rocas grandes. */
  obstacles: Obstacle[];
  field: RockField;
}

/** Radio del campo de práctica alrededor del punto de partida, m. */
export const FIELD_RADIUS_M = 170;
/** Tamaño desde el que una roca detiene al robot, m. */
export const SOLID_ROCK_M = 0.5;
/** Formas distintas de roca. */
export const ROCK_VARIANTS = 6;
const PEBBLE_RADIUS_M = 60;
const TUFT_RADIUS_M = 75;
/** Espacio libre que se deja alrededor del robot al empezar, m. */
const CLEAR_START_M = 8;

/** Las rocas de práctica de siempre, cuando no hay lectura de fotos. */
export const PRACTICE_FIELD: RockField = { solid: 84, solidSize: [0.5, 1.7], pebbles: 520, pebbleSize: [0.06, 0.36], tufts: 0, fromReading: false };

/** Rocas grandes y piedras para cada clase de cobertura, antes de ajustar por tamaño. */
const COVER_COUNTS: Record<RockCover, { solid: number; pebbles: number }> = {
  ninguna: { solid: 4, pebbles: 90 },
  poca: { solid: 36, pebbles: 700 },
  moderada: { solid: 90, pebbles: 1800 },
  mucha: { solid: 170, pebbles: 3200 },
};

/**
 * Cómo cambia el campo con el tamaño típico: con guijarros o piedras casi nada detiene al robot;
 * con bloques, sí.
 */
const SIZE_SHAPES: Record<RockSize, { solidShare: number; solidSize: readonly [number, number]; pebbleSize: readonly [number, number] }> = {
  guijarros: { solidShare: 0.08, solidSize: [0.5, 0.6], pebbleSize: [0.04, 0.12] },
  piedras: { solidShare: 0.3, solidSize: [0.5, 0.75], pebbleSize: [0.1, 0.32] },
  bloques: { solidShare: 1, solidSize: [0.5, 1.05], pebbleSize: [0.14, 0.48] },
  grandes: { solidShare: 1, solidSize: [0.8, 2.5], pebbleSize: [0.18, 0.49] },
};

const TUFT_COUNTS: Record<Vegetation, number> = { ninguna: 0, escasa: 500, moderada: 2600, densa: 6000 };

/**
 * Del resultado de la lectura de fotos a cuántas rocas y matas se reparten. `detail` (de 0 a 1)
 * baja la cantidad de piedras pequeñas y de matas en equipos lentos; las rocas que detienen al
 * robot no cambian, para que la prueba sea la misma con cualquier calidad.
 *
 * Las cantidades están topadas por rendimiento: con «muchas» rocas, en el lugar real habría más.
 */
export function rockField(
  reading: Pick<TerrainReading, "rockCover" | "rockSize" | "vegetation" | "surface"> | null,
  detail = 1,
): RockField {
  const scale = Math.min(1, Math.max(0.2, detail));
  if (!reading) return { ...PRACTICE_FIELD, pebbles: Math.round(PRACTICE_FIELD.pebbles * scale) };
  // Donde lo que cubre el suelo es vegetación, hay al menos una cubierta moderada de matas.
  const vegetation: Vegetation = reading.surface === "vegetacion" && TUFT_COUNTS[reading.vegetation] < TUFT_COUNTS.moderada ? "moderada" : reading.vegetation;
  const tufts = Math.round(TUFT_COUNTS[vegetation] * scale);
  if (reading.rockCover === null) return { ...PRACTICE_FIELD, pebbles: Math.round(PRACTICE_FIELD.pebbles * scale), tufts };
  const counts = COVER_COUNTS[reading.rockCover];
  const shape = reading.rockSize ? SIZE_SHAPES[reading.rockSize] : SIZE_SHAPES.piedras;
  return {
    solid: Math.round(counts.solid * shape.solidShare),
    solidSize: shape.solidSize,
    pebbles: Math.round(counts.pebbles * scale),
    pebbleSize: shape.pebbleSize,
    tufts,
    fromReading: true,
  };
}

/** Generador de números al azar repetible (mulberry32): la misma semilla da el mismo campo. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Módulos de la base, en metros respecto a su centro: `along` sobre su eje y `side` a su izquierda. */
const BASE_PLAN: { kind: CampKind; along: number; side: number; turn: number; radius: number }[] = [
  { kind: "habitat", along: 0, side: 0, turn: 0, radius: 3.4 },
  { kind: "domo", along: -7.5, side: 3.5, turn: 0, radius: 2.3 },
  { kind: "paneles", along: 1.5, side: -8, turn: 0, radius: 2.7 },
  { kind: "antena", along: 6.5, side: 5, turn: 0, radius: 0.7 },
  { kind: "deposito", along: 7, side: -3, turn: Math.PI / 2, radius: 1.2 },
  { kind: "cajas", along: -5, side: -4.5, turn: 0.4, radius: 1.2 },
  { kind: "bandera", along: 4.2, side: 2.6, turn: 0, radius: 0 },
];

/** Radio que ocupa la base entera, m. */
const BASE_RADIUS_M = 12;
/** Cuántos grados más llano tiene que ser el lado izquierdo para poner allí la base. */
const BASE_SIDE_MARGIN_DEG = 3;

/** Pendiente más fuerte (grados) alrededor de un punto, medida en ocho rumbos. */
function steepness(height: HeightAt, east: number, north: number): number {
  let worst = 0;
  for (let k = 0; k < 8; k++) {
    const angle = (k / 8) * Math.PI * 2;
    worst = Math.max(worst, Math.abs(slopeAlong(height, east, north, Math.cos(angle), Math.sin(angle))));
  }
  return worst;
}

/** Manchas suaves entre 0 y 1: las matas crecen en corros, no repartidas por igual. */
const patch = (east: number, north: number, seed: number) =>
  0.5 + 0.25 * Math.sin(east * 0.11 + seed) * Math.cos(north * 0.13 - seed * 0.7) + 0.25 * Math.sin((east + north) * 0.047 + seed * 1.9);

/**
 * Reparte la base, las rocas y las matas alrededor del punto de partida. `facing` es el rumbo con
 * el que arranca el robot (rad desde el este hacia el norte; por defecto, el norte): la base va
 * delante y a un lado (a su derecha, si el terreno lo permite), en el sitio más llano que haya a
 * unos 25 m, de modo que se ve al empezar y deja libre el camino recto. `field` dice cuántas rocas
 * y matas hay; por defecto, las de práctica.
 */
export function layoutCamp(
  start: { east: number; north: number },
  height: HeightAt,
  seed: number,
  facing = Math.PI / 2,
  field: RockField = PRACTICE_FIELD,
): CampLayout {
  const random = seededRandom(seed);

  // El sitio más llano de 42° a 58° a un lado del rumbo, a 24 o 29 m.
  const flattest = (side: number) => {
    let found = { east: start.east, north: start.north, slope: Infinity };
    for (const distance of [24, 29]) {
      for (const off of [42, 50, 58]) {
        const angle = facing + (side * off * Math.PI) / 180;
        const east = start.east + Math.cos(angle) * distance;
        const north = start.north + Math.sin(angle) * distance;
        const slope = steepness(height, east, north);
        // Entre sitios casi iguales se queda con el primero, el más cercano.
        if (slope < found.slope - 0.5) found = { east, north, slope };
      }
    }
    return found;
  };
  // A la derecha, donde no la tapa el panel de ajustes; a la izquierda solo si allí es mucho más llano.
  const right = flattest(-1);
  const left = flattest(1);
  const best = left.slope < right.slope - BASE_SIDE_MARGIN_DEG ? left : right;
  // El eje de la base mira hacia el robot.
  const heading = Math.atan2(start.north - best.north, start.east - best.east);
  const cos = Math.cos(heading);
  const sin = Math.sin(heading);
  const items: CampItem[] = BASE_PLAN.map((part) => ({
    kind: part.kind,
    east: best.east + cos * part.along - sin * part.side,
    north: best.north + sin * part.along + cos * part.side,
    heading: heading + part.turn,
    radius: part.radius,
  }));

  const rocks: Rock[] = [];
  const free = (east: number, north: number, margin: number, clear = CLEAR_START_M) =>
    Math.hypot(east - start.east, north - start.north) > clear + margin &&
    Math.hypot(east - best.east, north - best.north) > BASE_RADIUS_M + margin;
  const scatter = (count: number, radius: number, size: () => number) => {
    let tries = 0;
    let placed = 0;
    while (placed < count && tries < count * 8) {
      tries++;
      // Algo más juntas cerca del robot que en el borde del campo.
      const distance = random() ** 0.7 * radius;
      const angle = random() * Math.PI * 2;
      const east = start.east + Math.cos(angle) * distance;
      const north = start.north + Math.sin(angle) * distance;
      const rock = size();
      if (!free(east, north, rock)) continue;
      rocks.push({ east, north, size: rock, turn: random() * Math.PI * 2, variant: Math.floor(random() * ROCK_VARIANTS), solid: rock >= SOLID_ROCK_M });
      placed++;
    }
  };
  // Muchas rocas del tamaño menor y pocas del mayor.
  const [solidMin, solidMax] = field.solidSize;
  const [pebbleMin, pebbleMax] = field.pebbleSize;
  scatter(field.solid, FIELD_RADIUS_M, () => solidMin + random() ** 2.2 * (solidMax - solidMin));
  scatter(field.pebbles, PEBBLE_RADIUS_M, () => pebbleMin + random() ** 2 * (pebbleMax - pebbleMin));

  // Matas, con su propio azar: cambiar su cantidad no mueve ninguna roca.
  const tufts: Tuft[] = [];
  const grow = seededRandom(seed ^ 0x9e3779b9);
  const patchSeed = (seed % 97) * 0.37;
  for (let tries = 0; tufts.length < field.tufts && tries < field.tufts * 6; tries++) {
    const distance = grow() ** 0.6 * TUFT_RADIUS_M;
    const angle = grow() * Math.PI * 2;
    const east = start.east + Math.cos(angle) * distance;
    const north = start.north + Math.sin(angle) * distance;
    const size = 0.22 + grow() ** 1.6 * 0.5;
    const turn = grow() * Math.PI * 2;
    if (!free(east, north, 0.3, 1.6) || grow() > patch(east, north, patchSeed) ** 1.5 * 1.35) continue;
    tufts.push({ east, north, size, turn });
  }

  const obstacles: Obstacle[] = [
    ...items.filter((item) => item.radius > 0).map((item) => ({ east: item.east, north: item.north, radius: item.radius })),
    ...rocks.filter((rock) => rock.solid).map((rock) => ({ east: rock.east, north: rock.north, radius: rock.size * 0.5 })),
  ];
  return { base: { east: best.east, north: best.north, heading }, items, rocks, tufts, obstacles, field };
}

/** Los obstáculos que cuentan: con las rocas apagadas, solo los módulos de la base. */
export function activeObstacles(layout: CampLayout, rocksOn: boolean): Obstacle[] {
  return rocksOn ? layout.obstacles : layout.obstacles.slice(0, layout.items.filter((item) => item.radius > 0).length);
}
