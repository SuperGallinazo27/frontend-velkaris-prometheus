/**
 * Rueda rígida sobre suelo deformable: cuánto se hunde, cuánto patina y hasta qué pendiente
 * avanza. Es el modelo clásico de la terramecánica (la familia Bekker–Wong–Janosi–Hanamoto):
 *
 * - Presión y hundimiento de Bekker (1969): p = (kc / b + kφ) · z^n
 * - Esfuerzo de corte de Janosi y Hanamoto (1961): τ = (c + σ · tan φ) · (1 − e^(−j / K))
 * - Reparto de esfuerzos bajo la rueda de Wong y Reece (1967), con el ángulo de esfuerzo máximo
 *   θm = (c1 + c2 · i) · θ1 y el ángulo de salida θ2 = 0 (la rueda no apoya detrás de su eje).
 *
 * Todo en unidades del SI. Calcula una rueda lisa: los tacos (grousers) no se modelan, y por eso
 * el resultado tiende a ser conservador. Supone que el peso se reparte por igual entre las ruedas
 * y que todas traccionan. Es una estimación con parámetros de suelo publicados, no una medición.
 *
 * Límites conocidos:
 * - Bekker y Wong dan estimaciones aceptables con hundimientos moderados, hasta un tercio del
 *   radio (θ1 ≤ 48°); más allá, `reliable` queda en false.
 * - Con ruedas de menos de 50 cm de diámetro el modelo pierde precisión (Ding y otros, 2014).
 * - Es un modelo empírico: no recoge cómo la gravedad baja debilita el suelo granular. Un estudio
 *   con NASA (Hu y otros, 2025) muestra que por eso las pruebas en la Tierra con robots aligerados
 *   resultan demasiado optimistas.
 */

/** Parámetros del suelo. Las unidades de kc y kφ dependen de n (así se publican). */
export interface Soil {
  /** Exponente de hundimiento, sin unidad. */
  n: number;
  /** Módulo cohesivo de deformación, N/m^(n+1). */
  kc: number;
  /** Módulo friccional de deformación, N/m^(n+2). */
  kphi: number;
  /** Cohesión, Pa. */
  cohesion: number;
  /** Ángulo de fricción interna, grados. */
  frictionDeg: number;
  /** Módulo de deformación por corte K, m. */
  shearModulus: number;
}

export interface Wheel {
  /** Radio, m. */
  radius: number;
  /** Ancho, m. */
  width: number;
}

export interface Vehicle {
  /** Masa en marcha, kg. */
  mass: number;
  /** Número de ruedas (todas con tracción). */
  wheels: number;
  wheel: Wheel;
}

/** Constantes del ángulo de esfuerzo máximo de Wong y Reece. */
export interface StressShape {
  c1: number;
  c2: number;
}

/** Patinaje máximo que se calcula: más allá, la rueda gira casi en el sitio. */
export const MAX_SLIP = 0.95;

/** Hundimiento máximo, como fracción del radio, con el que el modelo da estimaciones aceptables. */
export const RELIABLE_SINKAGE = 1 / 3;

const DEG = Math.PI / 180;
/** Tramos de integración por región de contacto (regla de Simpson, debe ser par). */
const STEPS = 20;

export interface ContactForces {
  /** Fuerza normal al terreno que soporta la rueda, N. */
  normal: number;
  /** Tracción neta hacia delante (tracción menos resistencia), N. */
  drawbarPull: number;
  /** Par necesario en el eje, N·m. */
  torque: number;
}

/**
 * Fuerzas de una rueda con ángulo de entrada θ1 (rad) y patinaje i (0 a 1).
 * Integra el esfuerzo normal σ(θ) y el de corte τ(θ) a lo largo del arco de contacto.
 */
export function contactForces(wheel: Wheel, soil: Soil, entryAngle: number, slip: number, shape: StressShape): ContactForces {
  const { radius: r, width: b } = wheel;
  const theta1 = entryAngle;
  if (theta1 <= 0) return { normal: 0, drawbarPull: 0, torque: 0 };
  const thetaM = Math.min(theta1, Math.max(0, (shape.c1 + shape.c2 * slip) * theta1));
  const stiffness = (soil.kc / b + soil.kphi) * r ** soil.n;
  const tanPhi = Math.tan(soil.frictionDeg * DEG);
  const cos1 = Math.cos(theta1);
  const sin1 = Math.sin(theta1);

  // Delante del punto de esfuerzo máximo, la presión sigue la profundidad real bajo la rueda.
  const front = (t: number) => stiffness * Math.max(0, Math.cos(t) - cos1) ** soil.n;
  // Detrás, Wong y Reece la reflejan para que baje hasta cero en el ángulo de salida.
  const rear = (t: number) =>
    thetaM > 0 ? stiffness * Math.max(0, Math.cos(theta1 - (t / thetaM) * (theta1 - thetaM)) - cos1) ** soil.n : 0;

  let normal = 0;
  let pull = 0;
  let shearSum = 0;
  const integrate = (from: number, to: number, sigmaOf: (t: number) => number) => {
    if (to <= from) return;
    const h = (to - from) / STEPS;
    for (let k = 0; k <= STEPS; k++) {
      const t = from + k * h;
      const weight = ((k === 0 || k === STEPS ? 1 : k % 2 === 1 ? 4 : 2) * h) / 3;
      const sigma = sigmaOf(t);
      // Desplazamiento de corte acumulado desde que el punto del suelo entra en contacto.
      const j = r * (theta1 - t - (1 - slip) * (sin1 - Math.sin(t)));
      const tau = (soil.cohesion + sigma * tanPhi) * (1 - Math.exp(-Math.max(0, j) / soil.shearModulus));
      const cos = Math.cos(t);
      const sin = Math.sin(t);
      normal += weight * (sigma * cos + tau * sin);
      pull += weight * (tau * cos - sigma * sin);
      shearSum += weight * tau;
    }
  };
  integrate(0, thetaM, rear);
  integrate(thetaM, theta1, front);
  return { normal: r * b * normal, drawbarPull: r * b * pull, torque: r * r * b * shearSum };
}

export interface Contact extends ContactForces {
  /** Ángulo de entrada, rad. */
  entryAngle: number;
  /** Hundimiento, m. */
  sinkage: number;
  slip: number;
}

/**
 * Hundimiento con el que la rueda sostiene `load` newtons al patinar `slip`. Devuelve null si ni
 * hundida hasta el eje la sostiene: la rueda se entierra.
 */
export function solveContact(wheel: Wheel, soil: Soil, load: number, slip: number, shape: StressShape): Contact | null {
  const deepest = Math.PI / 2;
  if (contactForces(wheel, soil, deepest, slip, shape).normal < load) return null;
  let low = 0;
  let high = deepest;
  for (let step = 0; step < 24; step++) {
    const mid = (low + high) / 2;
    if (contactForces(wheel, soil, mid, slip, shape).normal < load) low = mid;
    else high = mid;
  }
  const forces = contactForces(wheel, soil, high, slip, shape);
  return { ...forces, entryAngle: high, sinkage: wheel.radius * (1 - Math.cos(high)), slip };
}

/** Lo que le pasa al vehículo al subir una pendiente. */
export type Outcome =
  /** Sube patinando `slip`. */
  | "avanza"
  /** Ni patinando al máximo consigue la tracción que pide la pendiente. */
  | "atascado"
  /** Las ruedas se hunden hasta el eje. */
  | "enterrado";

export interface Climb {
  slopeDeg: number;
  outcome: Outcome;
  /** Patinaje necesario (0 a 1); null si no avanza. */
  slip: number | null;
  /** Hundimiento de cada rueda, m; con el empuje máximo si no avanza, null si se entierra. */
  sinkage: number | null;
  /** Par por rueda, N·m; null si no avanza. */
  torque: number | null;
  /** false si el hundimiento supera un tercio del radio: el modelo deja de ser fiable. */
  reliable: boolean;
}

/** Puntos en los que se recorre el patinaje, de 0 a MAX_SLIP, antes de afinar. */
const SLIP_SAMPLES = 16;

/**
 * Subir en línea recta una pendiente de `slopeDeg` grados con gravedad `gravity` (m/s²).
 *
 * Al patinar más, la rueda empuja más pero también se hunde más. Con hundimientos grandes la
 * tracción sube y luego vuelve a bajar, así que no se puede suponer que siempre crece: se recorre
 * el patinaje desde cero y se toma el primero que basta para la pendiente.
 */
export function climb(vehicle: Vehicle, soil: Soil, gravity: number, slopeDeg: number, shape: StressShape): Climb {
  const beta = slopeDeg * DEG;
  const weight = (vehicle.mass * gravity) / vehicle.wheels;
  const load = weight * Math.cos(beta);
  const needed = weight * Math.sin(beta);
  const limit = vehicle.wheel.radius * RELIABLE_SINKAGE;
  const at = (slip: number) => solveContact(vehicle.wheel, soil, load, slip, shape);
  const done = (outcome: Outcome, contact: Contact | null, moving: boolean): Climb => ({
    slopeDeg,
    outcome,
    slip: moving && contact ? contact.slip : null,
    sinkage: contact ? contact.sinkage : null,
    torque: moving && contact ? contact.torque : null,
    reliable: contact !== null && contact.sinkage <= limit,
  });

  let strongest: Contact | null = null;
  let previous = 0;
  for (let k = 0; k <= SLIP_SAMPLES; k++) {
    const slip = (MAX_SLIP * k) / SLIP_SAMPLES;
    const contact = at(slip);
    if (!contact) continue;
    if (contact.drawbarPull >= needed) {
      if (k === 0) return done("avanza", contact, true);
      // Se afina entre la muestra anterior, que no bastaba, y esta, que sí.
      let low = previous;
      let high = slip;
      let enough = contact;
      for (let step = 0; step < 12; step++) {
        const mid = (low + high) / 2;
        const trial = at(mid);
        if (trial && trial.drawbarPull >= needed) {
          high = mid;
          enough = trial;
        } else low = mid;
      }
      return done("avanza", enough, true);
    }
    if (!strongest || contact.drawbarPull > strongest.drawbarPull) strongest = contact;
    previous = slip;
  }
  return strongest ? done("atascado", strongest, false) : done("enterrado", null, false);
}

/** El mismo vehículo en varias pendientes. */
export function slipCurve(vehicle: Vehicle, soil: Soil, gravity: number, slopes: readonly number[], shape: StressShape): Climb[] {
  return slopes.map((slope) => climb(vehicle, soil, gravity, slope, shape));
}

/**
 * Pendiente más fuerte (grados) que sube patinando como mucho `slipLimit`. Cero si ni en llano
 * lo consigue.
 */
export function maxSlope(vehicle: Vehicle, soil: Soil, gravity: number, slipLimit: number, shape: StressShape): number {
  const ok = (slope: number) => {
    const result = climb(vehicle, soil, gravity, slope, shape);
    return result.outcome === "avanza" && result.slip! <= slipLimit;
  };
  if (!ok(0)) return 0;
  let low = 0;
  let high = 60;
  if (ok(high)) return high;
  for (let step = 0; step < 16; step++) {
    const mid = (low + high) / 2;
    if (ok(mid)) low = mid;
    else high = mid;
  }
  return low;
}

/**
 * Hundimiento estático de Bekker para una rueda rígida (fórmula cerrada, válida con hundimientos
 * pequeños): z = [3W / ((3 − n) · b · (kc/b + kφ) · √D)]^(2 / (2n + 1)). Sirve de comprobación.
 */
export function bekkerSinkage(wheel: Wheel, soil: Soil, load: number): number {
  const { radius: r, width: b } = wheel;
  const k = soil.kc / b + soil.kphi;
  return ((3 * load) / ((3 - soil.n) * b * k * Math.sqrt(2 * r))) ** (2 / (2 * soil.n + 1));
}
