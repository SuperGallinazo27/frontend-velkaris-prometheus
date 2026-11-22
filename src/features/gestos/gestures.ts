/**
 * Lectura de gestos de la mano, a partir de los 21 puntos que MediaPipe entrega por cada mano que
 * ve la cámara. Son funciones puras: no tocan la cámara ni el navegador, y por eso se prueban con
 * `bun test` usando manos dibujadas con números.
 *
 * Con estos gestos se hacen dos cosas:
 * - Conducir el robot en el simulador (`driveFromHand`).
 * - Mover el holograma del hangar (`holoFromHands`).
 *
 * Convenciones:
 * - La imagen de la cámara mira a quien la usa: su izquierda queda a la derecha de la imagen. Aquí
 *   todo se entrega ya «como en un espejo»: x crece hacia la derecha de quien mira la pantalla.
 * - Índices de la mano: 0 muñeca; pulgar 1-4; índice 5-8; medio 9-12; anular 13-16; meñique 17-20.
 */

export interface Pt {
  x: number;
  y: number;
  z?: number;
}

/** Formas de la mano que se usan como órdenes. */
export type HandPose = "abierta" | "puno" | "paz" | "senalar" | "otra";

export interface HandReading {
  pose: HandPose;
  /**
   * Inclinación de la mano, rad: 0 con los dedos hacia arriba; positiva si se inclinan hacia la
   * izquierda de quien conduce, negativa hacia su derecha. Como girar un volante.
   */
  tilt: number;
  /** Centro de la palma, como en un espejo: x de 0 (izquierda) a 1 (derecha); y de 0 (arriba) a 1 (abajo). */
  x: number;
  y: number;
  /** Ancho de la palma como fracción del ancho de la imagen: crece al acercar la mano. */
  size: number;
}

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y, (a.z ?? 0) - (b.z ?? 0));
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Coseno del ángulo entre los tramos a→b y b→c: 1 si el dedo está recto, 0 si dobla 90°. */
function straightness(a: Pt, b: Pt, c: Pt): number {
  const v1 = { x: b.x - a.x, y: b.y - a.y, z: (b.z ?? 0) - (a.z ?? 0) };
  const v2 = { x: c.x - b.x, y: c.y - b.y, z: (c.z ?? 0) - (b.z ?? 0) };
  const n1 = Math.hypot(v1.x, v1.y, v1.z);
  const n2 = Math.hypot(v2.x, v2.y, v2.z);
  if (n1 === 0 || n2 === 0) return 0;
  return (v1.x * v2.x + v1.y * v2.y + v1.z * v2.z) / (n1 * n2);
}

const FINGERS = [
  { mcp: 5, pip: 6, tip: 8 },
  { mcp: 9, pip: 10, tip: 12 },
  { mcp: 13, pip: 14, tip: 16 },
  { mcp: 17, pip: 18, tip: 20 },
] as const;

/**
 * Qué dedos están estirados: [índice, medio, anular, meñique]. Se mide con los puntos «del mundo»
 * (en metros, con la mano como origen), que no cambian aunque la mano gire o se aleje. El pulgar no
 * cuenta: su posición varía mucho de una persona a otra y no hace falta para estos gestos.
 */
export function fingersUp(world: readonly Pt[]): [boolean, boolean, boolean, boolean] {
  if (world.length < 21) return [false, false, false, false];
  return FINGERS.map(({ mcp, pip, tip }) => {
    const straight = straightness(world[mcp], world[pip], world[tip]) > 0.55;
    const farFromWrist = dist(world[tip], world[0]) > dist(world[pip], world[0]);
    return straight && farFromWrist;
  }) as [boolean, boolean, boolean, boolean];
}

/** La forma de la mano según sus dedos. */
export function poseFromFingers(world: readonly Pt[]): HandPose {
  const [index, middle, ring, pinky] = fingersUp(world);
  if (index && middle && ring && pinky) return "abierta";
  if (!index && !middle && !ring && !pinky) return "puno";
  if (index && middle && !ring && !pinky) return "paz";
  if (index && !middle && !ring && !pinky) return "senalar";
  return "otra";
}

/** Los gestos que reconoce el clasificador de MediaPipe y que aquí se usan. */
const LABEL_POSES: Record<string, HandPose> = {
  Open_Palm: "abierta",
  Closed_Fist: "puno",
  Victory: "paz",
  Pointing_Up: "senalar",
};

/** A partir de qué seguridad se le cree al clasificador antes que a la regla de los dedos. */
export const LABEL_CONFIDENCE = 0.6;

/**
 * La forma de la mano. Se combinan dos lecturas: el clasificador de gestos de MediaPipe (entrenado
 * con manos reales; acierta bien de frente) y la regla de los dedos (que no depende de cómo esté
 * girada la mano). Manda el clasificador cuando está seguro; si duda o no reconoce el gesto —pasa
 * con la mano muy inclinada, al girar el volante—, decide la regla de los dedos.
 */
export function poseOf(world: readonly Pt[], label?: { name: string; score: number } | null): HandPose {
  const byLabel = label && label.score >= LABEL_CONFIDENCE ? LABEL_POSES[label.name] : undefined;
  return byLabel ?? poseFromFingers(world);
}

/**
 * Lee una mano. `image` son sus puntos en la imagen de la cámara (de 0 a 1, sin espejar) y `world`
 * los mismos puntos en metros; `aspect` es ancho/alto de la imagen, para medir ángulos de verdad.
 */
export function readHand(
  image: readonly Pt[],
  world: readonly Pt[],
  aspect: number,
  label?: { name: string; score: number } | null,
): HandReading | null {
  if (image.length < 21 || world.length < 21) return null;
  const palm = [0, 5, 9, 13, 17].map((k) => image[k]);
  const cx = palm.reduce((sum, p) => sum + p.x, 0) / palm.length;
  const cy = palm.reduce((sum, p) => sum + p.y, 0) / palm.length;
  // De la muñeca al nudillo del dedo medio: hacia dónde apunta la mano. En la imagen sin espejar,
  // +x es la izquierda de quien conduce; «y» crece hacia abajo.
  const dx = (image[9].x - image[0].x) * aspect;
  const dy = image[9].y - image[0].y;
  return {
    pose: poseOf(world, label),
    tilt: Math.atan2(dx, -dy),
    x: 1 - cx,
    y: cy,
    size: Math.hypot((image[5].x - image[17].x) * aspect, image[5].y - image[17].y) / aspect,
  };
}

/** De varias manos, la más cercana a la cámara (la más grande): es la que manda al conducir. */
export function mainHand(hands: readonly HandReading[]): HandReading | null {
  let best: HandReading | null = null;
  for (const hand of hands) if (!best || hand.size > best.size) best = hand;
  return best;
}

// ---------- Conducir ----------

const DEG = Math.PI / 180;
/** Con la mano casi recta no se gira: nadie la sostiene perfectamente vertical. */
export const STEER_DEAD = 9 * DEG;
/** Inclinación con la que el volante llega al tope. */
export const STEER_FULL = 38 * DEG;

/** Volante según la inclinación de la mano: de −1 (derecha) a 1 (izquierda), con zona muerta. */
export function steerFromTilt(tilt: number): number {
  const size = Math.abs(tilt);
  if (size <= STEER_DEAD) return 0;
  return Math.sign(tilt) * clamp((size - STEER_DEAD) / (STEER_FULL - STEER_DEAD), 0, 1);
}

export type DriveGestureState = "sin-mano" | "avanza" | "atras" | "frena" | "espera";

export interface DriveGesture {
  /** De −1 (marcha atrás) a 1 (adelante), como los mandos del simulador. */
  throttle: number;
  /** De −1 (derecha) a 1 (izquierda). */
  steer: number;
  state: DriveGestureState;
}

/**
 * La orden de conducción que da una mano:
 * - Mano abierta: avanza. Inclinarla gira, como un volante.
 * - Dos dedos (señal de paz): marcha atrás, girando igual.
 * - Puño: frena.
 * - Sin mano a la vista, o con un gesto que no se reconoce: el robot se detiene. Nunca sigue solo.
 */
export function driveFromHand(hand: HandReading | null): DriveGesture {
  if (!hand) return { throttle: 0, steer: 0, state: "sin-mano" };
  if (hand.pose === "abierta") return { throttle: 1, steer: steerFromTilt(hand.tilt), state: "avanza" };
  if (hand.pose === "paz") return { throttle: -1, steer: steerFromTilt(hand.tilt), state: "atras" };
  if (hand.pose === "puno") return { throttle: 0, steer: 0, state: "frena" };
  return { throttle: 0, steer: 0, state: "espera" };
}

/**
 * Filtro para que un gesto de paso no cuente: un valor nuevo sustituye al actual solo si se
 * mantiene durante el tiempo que pide `delay` para ese valor.
 */
export class Steady<T> {
  private current: T;
  private candidate: T;
  private since = 0;
  private delay: (next: T, current: T) => number;

  constructor(initial: T, delay: (next: T, current: T) => number) {
    this.current = initial;
    this.candidate = initial;
    this.delay = delay;
  }

  update(value: T, now: number): T {
    if (value === this.current) {
      this.candidate = value;
      return this.current;
    }
    if (value !== this.candidate) {
      this.candidate = value;
      this.since = now;
    }
    if (now - this.since >= this.delay(value, this.current)) this.current = value;
    return this.current;
  }

  get value(): T {
    return this.current;
  }
}

/**
 * Cuánto debe mantenerse una forma de la mano para aceptarla al conducir, ms. Frenar es inmediato;
 * arrancar o cambiar de sentido pide un instante; un gesto sin reconocer tarda más en detener el
 * robot, porque al inclinar la mano el detector duda a ratos.
 */
export function driveDelay(next: HandPose | null): number {
  if (next === "puno") return 60;
  if (next === null) return 280;
  if (next === "abierta" || next === "paz") return 140;
  return 320;
}

// ---------- Holograma ----------

/** Vuelta que da el holograma al cruzar la mano toda la imagen, rad. */
export const HOLO_YAW_GAIN = 5.2;
export const HOLO_PITCH_GAIN = 2.2;
/** Separación entre las dos manos (fracción del ancho) con el robot armado y desarmado del todo. */
export const HOLO_HANDS_CLOSED = 0.18;
export const HOLO_HANDS_OPEN = 0.56;
/** Tiempo señalando con el índice para pasar al componente siguiente, ms. */
export const HOLO_POINT_HOLD_MS = 650;
/** Suavizado de la posición de la mano (0 a 1): quita el temblor del detector. */
const HOLO_SMOOTH = 0.45;
/** Movimientos menores que esto se ignoran: son ruido. */
const HOLO_NOISE = 0.0025;

export type HoloGestureState = "sin-mano" | "girar" | "desarmar" | "pausa" | "senalar" | "espera";

export interface HoloTrack {
  /** Última posición suavizada de la mano que gira el holograma. */
  last: { x: number; y: number } | null;
  /** Desde cuándo se señala con el índice, y si ya se pasó de componente con ese gesto. */
  pointSince: number | null;
  pointFired: boolean;
}

export const emptyHoloTrack = (): HoloTrack => ({ last: null, pointSince: null, pointFired: false });

export interface HoloCommand {
  /** Giro a sumar al holograma, rad. */
  yaw: number;
  pitch: number;
  /** Cuánto desarmar, de 0 a 1; null si este gesto no lo cambia. */
  explode: number | null;
  /** true una sola vez por gesto: pasar al componente siguiente. */
  next: boolean;
  /** Avance del gesto de señalar hacia el cambio de componente, de 0 a 1. */
  pointProgress: number;
  state: HoloGestureState;
}

/**
 * La orden que dan las manos al holograma:
 * - Una mano abierta que se mueve: lo gira, como arrastrándolo.
 * - Dos manos: al separarlas se desarma; al juntarlas se arma.
 * - Puño: lo suelta (sirve para recolocar la mano sin girarlo).
 * - Señalar con el índice un instante: pasa al componente siguiente.
 */
export function holoFromHands(hands: readonly HandReading[], track: HoloTrack, now: number): { command: HoloCommand; track: HoloTrack } {
  const idle: HoloCommand = { yaw: 0, pitch: 0, explode: null, next: false, pointProgress: 0, state: "sin-mano" };
  if (hands.length === 0) return { command: idle, track: emptyHoloTrack() };

  if (hands.length >= 2) {
    const [a, b] = hands;
    const gap = Math.hypot(a.x - b.x, a.y - b.y);
    const explode = clamp((gap - HOLO_HANDS_CLOSED) / (HOLO_HANDS_OPEN - HOLO_HANDS_CLOSED), 0, 1);
    return { command: { ...idle, explode, state: "desarmar" }, track: emptyHoloTrack() };
  }

  const hand = hands[0];
  if (hand.pose === "senalar") {
    const since = track.pointSince ?? now;
    const progress = clamp((now - since) / HOLO_POINT_HOLD_MS, 0, 1);
    const fire = progress >= 1 && !track.pointFired;
    return {
      command: { ...idle, next: fire, pointProgress: track.pointFired ? 1 : progress, state: "senalar" },
      track: { last: null, pointSince: since, pointFired: track.pointFired || fire },
    };
  }
  if (hand.pose === "abierta") {
    const last = track.last;
    if (!last) return { command: { ...idle, state: "girar" }, track: { last: { x: hand.x, y: hand.y }, pointSince: null, pointFired: false } };
    const x = last.x + (hand.x - last.x) * HOLO_SMOOTH;
    const y = last.y + (hand.y - last.y) * HOLO_SMOOTH;
    const dx = Math.abs(x - last.x) < HOLO_NOISE ? 0 : x - last.x;
    const dy = Math.abs(y - last.y) < HOLO_NOISE ? 0 : y - last.y;
    return {
      command: { ...idle, yaw: dx * HOLO_YAW_GAIN, pitch: dy * HOLO_PITCH_GAIN, state: "girar" },
      track: { last: { x, y }, pointSince: null, pointFired: false },
    };
  }
  return { command: { ...idle, state: hand.pose === "puno" ? "pausa" : "espera" }, track: emptyHoloTrack() };
}
