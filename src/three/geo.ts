/** Matemática común de las escenas 3D: interpolación, ángulos y puntos sobre una esfera. Funciones puras. */

export type Vec3 = readonly [number, number, number];

const rad = (deg: number) => (deg * Math.PI) / 180;

export const clamp = (x: number, min: number, max: number) => Math.min(max, Math.max(min, x));

export const clamp01 = (x: number) => clamp(x, 0, 1);

/** Interpolación lineal, exacta en ambos extremos. */
export const lerp = (a: number, b: number, t: number) => a * (1 - t) + b * t;

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/**
 * Punto de una esfera para una latitud y longitud en grados.
 * Longitud 0 mira a +X y longitud -90 (oeste) mira a +Z, igual que la textura equirrectangular.
 */
export function latLonToVec3(lat: number, lon: number, radius = 1): Vec3 {
  const phi = rad(lat);
  const lambda = rad(lon);
  return [
    radius * Math.cos(phi) * Math.cos(lambda),
    radius * Math.sin(phi),
    -radius * Math.cos(phi) * Math.sin(lambda),
  ];
}

/** Giro en Y (radianes) que deja la longitud dada mirando a +Z. */
export function yawFacing(lon: number): number {
  return -Math.PI / 2 - rad(lon);
}

/** Diferencia angular más corta de `from` a `to`, en (-π, π]. */
export function shortestAngle(from: number, to: number): number {
  const tau = Math.PI * 2;
  let d = (to - from) % tau;
  if (d > Math.PI) d -= tau;
  if (d <= -Math.PI) d += tau;
  return d;
}

/** Igual que `shortestAngle`, en grados: (-180, 180]. */
export function shortestDegrees(from: number, to: number): number {
  return (shortestAngle(rad(from), rad(to)) * 180) / Math.PI;
}
