/**
 * Matemática del recorrido de la portada: avance por scroll, encuadres de cámara
 * y orientación de los planetas. Funciones puras, sin Three.js, para poder probarlas.
 */

export type Vec3 = readonly [number, number, number];

export interface Shot {
  /** Posición de la cámara. */
  pos: Vec3;
  /** Punto al que mira la cámara. */
  target: Vec3;
  /** Desplazamiento horizontal del sujeto en pantalla ancha (fracción del ancho; positivo = derecha). */
  shift: number;
  /** 1 si el encuadre debe alejarse en pantallas verticales para que el planeta quepa; 0 si no. */
  fit: number;
  /** Punto por el que se curva el vuelo hacia el siguiente encuadre, para rodear un planeta en vez de atravesarlo. */
  via?: Vec3;
}

const rad = (deg: number) => (deg * Math.PI) / 180;

export const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** Interpolación lineal, exacta en ambos extremos. */
export const lerp = (a: number, b: number, t: number) => a * (1 - t) + b * t;

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/**
 * Avance continuo entre capítulos según la línea central de la ventana:
 * 0 en el centro del primer capítulo y n-1 en el centro del último.
 */
export function chapterProgress(centers: readonly number[], y: number): number {
  const last = centers.length - 1;
  if (last < 1 || y <= centers[0]) return 0;
  for (let i = 0; i < last; i++) {
    const a = centers[i];
    const b = centers[i + 1];
    if (y < b) return b > a ? i + (y - a) / (b - a) : i;
  }
  return last;
}

/** Encuadre interpolado. La fracción entre dos capítulos se suaviza para que la cámara repose en cada uno. */
export function sampleShots(shots: readonly Shot[], p: number): Shot {
  const last = shots.length - 1;
  const clamped = Math.min(last, Math.max(0, p));
  const i = Math.min(last - 1, Math.floor(clamped));
  const a = shots[i];
  const b = shots[i + 1] ?? a;
  const t = smoothstep(0, 1, clamped - i);
  const mix = (u: Vec3, v: Vec3): Vec3 => [
    lerp(u[0], v[0], t),
    lerp(u[1], v[1], t),
    lerp(u[2], v[2], t),
  ];
  const via = a.via;
  return {
    pos: via ? mix(mix(a.pos, via), mix(via, b.pos)) : mix(a.pos, b.pos),
    target: mix(a.target, b.target),
    shift: lerp(a.shift, b.shift, t),
    fit: lerp(a.fit, b.fit, t),
  };
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

/** Capítulo en el que la sonda vuelve a estar en la Tierra; ahí termina el indicador del viaje. */
export const RETURN_CHAPTER = 4;

/** Tramo Tierra → Luna recorrido por la sonda (0 a 1) para un avance de capítulos dado. */
export function moonLegT(p: number): number {
  return smoothstep(0.2, 0.9, p);
}

/** Tramo Luna → Marte recorrido por la sonda (0 a 1). */
export function marsLegT(p: number): number {
  return smoothstep(1.15, 1.9, p);
}

/** Tramo de regreso Marte → Tierra recorrido por la sonda (0 a 1). */
export function travelT(p: number): number {
  return smoothstep(2.35, 3.75, p);
}

/** Avance del viaje Tierra → Luna → Marte → Tierra (0 a 1) para el indicador inferior. */
export function journeyFraction(p: number): number {
  return clamp01(p / RETURN_CHAPTER);
}

/** Centro de cada cuerpo en la escena. La Tierra es el eje: el viaje sale de ella y vuelve a ella. */
export const EARTH_CENTER: Vec3 = [3.5, -1.2, -26];
export const MOON_CENTER: Vec3 = [6.65, 0.95, -30.7];
/** Desde el capítulo de Marte, la Tierra y la Luna quedan ocultas detrás de él. */
export const MARS_CENTER: Vec3 = [0, 0, 0];

/** Un encuadre por capítulo de la portada, en el mismo orden que las secciones. */
export const SHOTS: readonly Shot[] = [
  // Portada: la Tierra a la derecha del titular, con la Luna al fondo
  { pos: [3.7, -0.95, -21.2], target: EARTH_CENTER, shift: 0.16, fit: 1 },
  // Primer alcance: la Luna de cerca, a la izquierda. Después la cámara retrocede hasta rodear Marte.
  { pos: [6.45, 1.05, -28.8], target: MOON_CENTER, shift: -0.21, fit: 1, via: [4.5, 1.5, -4] },
  // Siguiente alcance: Marte de cerca, a la derecha
  { pos: [0.25, 0.15, 3.1], target: MARS_CENTER, shift: 0.21, fit: 1, via: [3.2, 1.6, 0.5] },
  // Método: de regreso, con la Tierra al fondo
  { pos: [0.6, 1, -6.5], target: [3, -0.6, -24], shift: 0.1, fit: 0 },
  // Candidatos: la Tierra de cerca, a la izquierda
  { pos: [3.9, -0.9, -21.7], target: EARTH_CENTER, shift: -0.21, fit: 1 },
  // Explora: la Tierra arriba, el texto centrado debajo
  { pos: [1.7, 0.26, -18.8], target: [3.5, -2.7, -26], shift: 0, fit: 1 },
];
