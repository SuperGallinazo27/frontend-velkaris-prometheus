/**
 * Cuentas del holograma que no necesitan pantalla: hacia dónde sale cada pieza al desarmar el
 * robot, qué pieza lleva la etiqueta de su componente y a qué distancia se pone la cámara.
 *
 * Sistema del robot: +x hacia delante, +y hacia arriba, +z hacia su derecha; el suelo está en y = 0.
 */
import type { HoloRobotId } from "./parts";

export type Vec3 = readonly [number, number, number];

/** Caja de una pieza o del robot entero, en el sistema del robot, m. */
export interface Box {
  min: Vec3;
  max: Vec3;
}

/**
 * Ajuste del despiece de un componente: `radial` multiplica cuánto se aleja del centro del robot y
 * `bias` le suma un empujón propio (en metros para un robot de 3 m; se escala con el tamaño).
 */
export interface ExplodeRule {
  radial?: number;
  bias?: Vec3;
}

/**
 * Un despiece se compone a mano, como en un manual: el cuerpo sube un poco, lo que va encima sube
 * más, lo de delante sale hacia delante y las ruedas se abren hacia los lados. Lo que no tiene
 * regla solo se aleja del centro.
 */
export const EXPLODE_RULES: Record<HoloRobotId, Record<string, ExplodeRule>> = {
  perseverance: {
    cuerpo: { radial: 0.2, bias: [0, 0.3, 0] },
    suspension: { radial: 0.9 },
    ruedas: { radial: 1.25 },
    mastil: { radial: 0.6, bias: [0.15, 1.05, -0.1] },
    brazo: { radial: 0.5, bias: [0.55, 0.25, 0.15] },
    torreta: { radial: 0.5, bias: [1.25, 0.2, 0.2] },
    rtg: { radial: 0.6, bias: [-0.6, 0.55, 0] },
    antenas: { radial: 1.3, bias: [-0.15, 0.95, 0] },
    hazcams: { radial: 1.25, bias: [0, -0.1, 0] },
    rimfax: { radial: 0.7, bias: [-0.75, -0.2, 0] },
  },
  curiosity: {
    cuerpo: { radial: 0.2, bias: [0, 0.3, 0] },
    suspension: { radial: 0.9 },
    ruedas: { radial: 1.25 },
    mastil: { radial: 0.6, bias: [0.15, 1.05, 0.1] },
    brazo: { radial: 0.5, bias: [0.55, 0.25, 0] },
    torreta: { radial: 0.5, bias: [1.25, 0.2, 0] },
    rtg: { radial: 0.6, bias: [-0.6, 0.55, 0] },
    antenas: { radial: 1.3, bias: [-0.15, 0.95, 0] },
    hazcams: { radial: 1.25, bias: [0, -0.1, 0] },
  },
  viper: {
    cuerpo: { radial: 0.2, bias: [0, 0.1, 0] },
    radiador: { radial: 0.3, bias: [0, 0.75, 0] },
    paneles: { radial: 2.3 },
    suspension: { radial: 1.1 },
    ruedas: { radial: 1.9 },
    mastil: { radial: 0.5, bias: [0.35, 1.0, -0.25] },
    antena: { radial: 0.6, bias: [0.1, 1.15, 0.5] },
    taladro: { radial: 0.3, bias: [0, 1.75, 0] },
    instrumentos: { radial: 0.8, bias: [0.95, 0.05, 0] },
  },
  lrv: {
    bastidor: { radial: 0.1 },
    suspension: { radial: 0.75 },
    ruedas: { radial: 1.15 },
    guardabarros: { radial: 1.0, bias: [0, 0.75, 0] },
    asientos: { radial: 0.9, bias: [0, 0.95, 0] },
    consola: { radial: 0.4, bias: [0, 1.55, 0] },
    baterias: { radial: 0.5, bias: [0.55, 0.7, 0] },
    herramientas: { radial: 0.5, bias: [-0.6, 0.6, 0] },
    antena: { radial: 0.7, bias: [0.45, 1.1, 0.35] },
    camara: { radial: 0.8, bias: [0.85, 0.5, -0.5] },
  },
};

/** Cuánto se aleja del centro una pieza sin regla, por cada metro que ya está lejos. */
export const RADIAL_GAIN = 0.55;

const centerOf = (box: Box): [number, number, number] => [
  (box.min[0] + box.max[0]) / 2,
  (box.min[1] + box.max[1]) / 2,
  (box.min[2] + box.max[2]) / 2,
];

/** Lado mayor del robot dividido entre 3 m: el tamaño con el que se escalan los empujones. */
export const robotScale = (robot: Box) => Math.max(robot.max[0] - robot.min[0], robot.max[1] - robot.min[1], robot.max[2] - robot.min[2]) / 3;

/**
 * Cuánto se desplaza una pieza con el robot desarmado del todo. El centro del despiece queda
 * bajo, a un tercio de la altura: así casi todo sube y se abre, y nada se hunde en el suelo.
 */
export function explodeOffset(piece: Box, robot: Box, rule: ExplodeRule | undefined): [number, number, number] {
  const robotCenter = centerOf(robot);
  const origin: Vec3 = [robotCenter[0], robot.min[1] + (robot.max[1] - robot.min[1]) * 0.32, robotCenter[2]];
  const center = centerOf(piece);
  const gain = RADIAL_GAIN * (rule?.radial ?? 1);
  const scale = robotScale(robot);
  const bias = rule?.bias ?? [0, 0, 0];
  const offset: [number, number, number] = [
    (center[0] - origin[0]) * gain + bias[0] * scale,
    (center[1] - origin[1]) * gain + bias[1] * scale,
    (center[2] - origin[2]) * gain + bias[2] * scale,
  ];
  // Lo que toca el suelo no baja: una rueda se abre hacia fuera, no se entierra.
  const floor = robot.min[1] - piece.min[1];
  if (offset[1] < floor) offset[1] = floor;
  return offset;
}

/**
 * De las piezas de un componente, cuál lleva la etiqueta: siempre la misma, para que no salte al
 * girar. Se prefiere la de la derecha, delante y arriba, que es la que da a la cámara al empezar.
 */
export function representative(centers: readonly Vec3[]): number {
  let best = 0;
  let bestScore = -Infinity;
  centers.forEach((center, index) => {
    const score = center[2] + center[0] * 0.6 + center[1] * 0.3;
    if (score > bestScore) {
      best = index;
      bestScore = score;
    }
  });
  return best;
}

/** Distancia a la que cabe entera una esfera de radio `radius`, con el campo de visión vertical dado. */
export function fitDistance(radius: number, fovDeg: number, aspect: number): number {
  const vertical = (fovDeg * Math.PI) / 180;
  const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * aspect);
  return radius / Math.sin(Math.min(vertical, horizontal) / 2);
}

/** Arranque y llegada suaves, de 0 a 1. */
export const ease = (t: number) => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
};

/** Acerca `current` a `target` sin depender de los cuadros por segundo: `rate` es la rapidez, 1/s. */
export const approach = (current: number, target: number, rate: number, dt: number) => current + (target - current) * (1 - Math.exp(-rate * dt));
