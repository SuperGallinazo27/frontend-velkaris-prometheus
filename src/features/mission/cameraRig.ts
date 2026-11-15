/**
 * Dónde se pone cada cámara del simulador. Funciones puras, sin 3D, para poder probarlas.
 *
 * Coordenadas de la escena: x = este, y = altura, z = −norte. El rumbo se mide en radianes desde el
 * este hacia el norte, como en `drive.ts`.
 */

export interface Point3 {
  x: number;
  y: number;
  z: number;
}

/** Cámara «Seguir»: cuánto queda detrás y encima del robot, y a qué punto por delante mira. */
export interface ChaseRig {
  /** Metros por detrás del robot. */
  back: number;
  /** Metros por encima del suelo del robot. */
  up: number;
  /** Metros por delante del robot a los que mira. */
  ahead: number;
  /** Altura del punto al que mira sobre el suelo, m. */
  lift: number;
}

/**
 * La cámara que sigue al robot va detrás y bastante por encima, y mira a un punto del suelo varios
 * metros por delante: así el robot queda en el tercio de abajo de la imagen y lo que tiene delante,
 * en el centro. Si mirase al robot, este taparía justo el camino.
 *
 * Las distancias están elegidas para que, con el ángulo de visión del simulador (48°), quepan a la
 * vez el horizonte (arriba) y las ruedas traseras del robot (abajo, sin esconderse tras los datos).
 */
export function chaseRig(robotLength: number): ChaseRig {
  const size = Math.max(robotLength, 1.6);
  return { back: size * 2.2 + 4.6, up: size * 0.9 + 2.95, ahead: size * 1.5 + 4.6, lift: 0.5 };
}

/** Vector unitario hacia donde mira el robot, en coordenadas de la escena. */
export const forwardOf = (heading: number): Point3 => ({ x: Math.cos(heading), y: 0, z: -Math.sin(heading) });

/** Punto al que mira la cámara «Seguir» y sitio de la cámara, con el robot en `robot` y el suelo llano. */
export function chasePoints(robot: Point3, heading: number, rig: ChaseRig): { target: Point3; camera: Point3 } {
  const f = forwardOf(heading);
  return {
    target: { x: robot.x + f.x * rig.ahead, y: robot.y + rig.lift, z: robot.z + f.z * rig.ahead },
    camera: { x: robot.x - f.x * rig.back, y: robot.y + rig.up, z: robot.z - f.z * rig.back },
  };
}

/** Cuánto baja la vista de la cámara «Seguir» respecto al horizonte, en grados. */
export function chasePitchDeg(rig: ChaseRig): number {
  return (Math.atan2(rig.up - rig.lift, rig.back + rig.ahead) * 180) / Math.PI;
}

/**
 * Ángulo, en grados bajo el centro de la imagen, al que queda un punto del robot visto por la
 * cámara «Seguir» (positivo: por debajo del centro). El punto está a `heightOnRobot` metros del
 * suelo y `behind` metros por detrás del centro del robot (sus ruedas traseras, por ejemplo). Sirve
 * para comprobar que el robot no tapa lo que tiene delante ni se sale por abajo.
 */
export function chaseOffsetDeg(rig: ChaseRig, heightOnRobot: number, behind = 0): number {
  const toPoint = Math.atan2(rig.up - heightOnRobot, rig.back - behind);
  return (toPoint * 180) / Math.PI - chasePitchDeg(rig);
}

/** Cuánto puede girar la vista de la «cámara del robot» respecto al frente, en radianes. */
export const LOOK_LIMITS = { yaw: (110 * Math.PI) / 180, up: (28 * Math.PI) / 180, down: (38 * Math.PI) / 180 };

/** La vista de la cámara del robot, sin salirse de lo que una cabeza con cámaras puede girar. */
export function clampLook(yaw: number, pitch: number): { yaw: number; pitch: number } {
  return {
    yaw: Math.min(LOOK_LIMITS.yaw, Math.max(-LOOK_LIMITS.yaw, yaw)),
    pitch: Math.min(LOOK_LIMITS.up, Math.max(-LOOK_LIMITS.down, pitch)),
  };
}
