/**
 * Recorrido de prueba del robot sobre el relieve real de un lugar. En cada paso toma la pendiente
 * del terreno bajo él, en la dirección en la que se mueve, y la convierte en patinaje, hundimiento
 * y par con la tabla del modelo rueda-suelo (terramechanics.ts).
 *
 * Hay dos formas de moverlo: en línea recta hacia un destino (`stepDrive`) o con mandos, como en
 * un videojuego (`stepManual`: acelerar, frenar, girar, marcha atrás y choques con obstáculos).
 * La física es la misma en las dos.
 *
 * Bajando, el modelo no calcula el frenado: se usan los valores del llano, que sobrestiman un poco
 * el patinaje y la energía. La pendiente se mide sobre 10 m, la escala del relieve disponible (unos
 * 30 m por dato): no ve rocas ni zanjas pequeñas. No hay deslizamiento lateral ni vuelco.
 */
import type { Climb } from "./terramechanics";
import type { TerrainGrid } from "./twin";

/** Patinaje, hundimiento y par por pendiente, calculados una vez para un robot y un suelo. */
export interface SlipTable {
  /** Pendientes en grados, de 0 en adelante, con paso fijo. */
  slopes: number[];
  climbs: Climb[];
}

export interface DriveVehicle {
  wheels: number;
  wheelRadius: number;
  /** Velocidad de la rueda (ω·r), m/s: la que tendría sin patinar. */
  wheelSpeed: number;
}

/** Altura (m) en un punto del área, en metros desde su centro (este, norte). */
export type HeightAt = (east: number, north: number) => number;

/** Interpolación bilineal sobre la malla de un área; fuera de ella, el borde más cercano. */
export function heightSampler(grid: TerrainGrid): HeightAt {
  const points = grid.cells + 1;
  const cell = grid.sizeM / grid.cells;
  const half = grid.sizeM / 2;
  return (east, north) => {
    const x = Math.min(grid.cells, Math.max(0, (east + half) / cell));
    const y = Math.min(grid.cells, Math.max(0, (north + half) / cell));
    const c0 = Math.min(grid.cells - 1, Math.floor(x));
    const r0 = Math.min(grid.cells - 1, Math.floor(y));
    const tx = x - c0;
    const ty = y - r0;
    const at = (r: number, c: number) => grid.heights[r * points + c];
    const south = at(r0, c0) * (1 - tx) + at(r0, c0 + 1) * tx;
    const northRow = at(r0 + 1, c0) * (1 - tx) + at(r0 + 1, c0 + 1) * tx;
    return south * (1 - ty) + northRow * ty;
  };
}

/**
 * Altura sobre los mismos triángulos con los que se dibuja la malla 3D (cada celda, partida por la
 * diagonal que va del sureste al noroeste). Así las ruedas pisan exactamente el suelo que se ve.
 */
export function meshSampler(grid: TerrainGrid): HeightAt {
  const points = grid.cells + 1;
  const cell = grid.sizeM / grid.cells;
  const half = grid.sizeM / 2;
  const heights = grid.heights;
  return (east, north) => {
    const x = Math.min(grid.cells, Math.max(0, (east + half) / cell));
    const y = Math.min(grid.cells, Math.max(0, (north + half) / cell));
    const c0 = Math.min(grid.cells - 1, Math.floor(x));
    const r0 = Math.min(grid.cells - 1, Math.floor(y));
    const tx = x - c0;
    const ty = y - r0;
    const a = r0 * points + c0;
    const southEast = heights[a + 1];
    const northWest = heights[a + points];
    if (tx + ty <= 1) {
      const southWest = heights[a];
      return southWest + (southEast - southWest) * tx + (northWest - southWest) * ty;
    }
    const northEast = heights[a + points + 1];
    return northEast + (northWest - northEast) * (1 - tx) + (southEast - northEast) * (1 - ty);
  };
}

/** Base sobre la que se mide la pendiente, m. */
export const SLOPE_BASE_M = 10;

/** Pendiente en grados al avanzar en la dirección (dx, dy) unitaria: positiva si sube. */
export function slopeAlong(height: HeightAt, east: number, north: number, dx: number, dy: number): number {
  const half = SLOPE_BASE_M / 2;
  const rise = height(east + dx * half, north + dy * half) - height(east - dx * half, north - dy * half);
  return (Math.atan2(rise, SLOPE_BASE_M) * 180) / Math.PI;
}

/**
 * El rumbo más cómodo para arrancar en un punto, en radianes desde el este hacia el norte: el más
 * llano de los que no suben y, si todos suben, el que menos sube. En llano, el norte.
 */
export function easyHeading(height: HeightAt, east: number, north: number): number {
  let best = Math.PI / 2;
  let bestCost = Infinity;
  for (let k = 0; k < 16; k++) {
    const angle = Math.PI / 2 + (k / 16) * Math.PI * 2;
    const slope = slopeAlong(height, east, north, Math.cos(angle), Math.sin(angle));
    // Subir es peor que cualquier bajada: así el robot no empieza atascado.
    const cost = slope > 0.3 ? 100 + slope : Math.abs(slope);
    if (cost < bestCost - 1e-6) {
      best = angle;
      bestCost = cost;
    }
  }
  return best;
}

/** Lo que pasa en una pendiente según la tabla; null si ahí no avanza. */
export function lookup(table: SlipTable, slopeDeg: number): { slip: number; sinkage: number; torque: number } | null {
  const flat = table.climbs[0];
  if (slopeDeg <= 0) {
    return flat.outcome === "avanza" ? { slip: flat.slip!, sinkage: flat.sinkage!, torque: flat.torque! } : null;
  }
  const step = table.slopes[1] - table.slopes[0];
  const index = slopeDeg / step;
  const low = Math.floor(index);
  if (low + 1 >= table.climbs.length) return null;
  const a = table.climbs[low];
  const b = table.climbs[low + 1];
  if (a.outcome !== "avanza" || b.outcome !== "avanza") return null;
  const t = index - low;
  const mix = (p: number, q: number) => p + (q - p) * t;
  return { slip: mix(a.slip!, b.slip!), sinkage: mix(a.sinkage!, b.sinkage!), torque: mix(a.torque!, b.torque!) };
}

/** Qué está haciendo el robot, para decirlo en pantalla. */
export type Motion = "parado" | "adelante" | "atras" | "girando";

export interface DriveState {
  east: number;
  north: number;
  /** Hacia dónde mira el robot (unitaria). */
  dx: number;
  dy: number;
  /** Recorrido horizontal acumulado, m. */
  distance: number;
  /** Tiempo real que llevaría, s. */
  time: number;
  /** Energía en las ruedas, J. */
  energy: number;
  /** Giro acumulado de las ruedas, rad. */
  wheelAngle: number;
  /** Pendiente en la dirección en la que se mueve (o hacia delante, si está parado), en grados. */
  slope: number;
  slip: number;
  sinkage: number;
  maxSlope: number;
  maxSlip: number;
  status: "listo" | "avanzando" | "llego" | "atascado";
  motion: Motion;
  /** Veces que se topó con un obstáculo y veces que se quedó atascado. */
  collisions: number;
  stuckTimes: number;
  /** true mientras está apoyado contra un obstáculo o contra el borde del área. */
  touching: boolean;
}

export function startDrive(east: number, north: number, targetEast: number, targetNorth: number): DriveState {
  const length = Math.hypot(targetEast - east, targetNorth - north) || 1;
  return {
    east,
    north,
    dx: (targetEast - east) / length,
    dy: (targetNorth - north) / length,
    distance: 0,
    time: 0,
    energy: 0,
    wheelAngle: 0,
    slope: 0,
    slip: 0,
    sinkage: 0,
    maxSlope: 0,
    maxSlip: 0,
    status: "listo",
    motion: "parado",
    collisions: 0,
    stuckTimes: 0,
    touching: false,
  };
}

/** Distancia al destino por debajo de la cual se considera que llegó, m. */
const ARRIVAL_M = 0.25;

/** Avanza `dt` segundos de tiempo real en línea recta hacia el destino. Devuelve un estado nuevo. */
export function stepDrive(
  state: DriveState,
  dt: number,
  height: HeightAt,
  table: SlipTable,
  vehicle: DriveVehicle,
  targetEast: number,
  targetNorth: number,
): DriveState {
  if (state.status === "llego" || state.status === "atascado") return state;
  const slope = slopeAlong(height, state.east, state.north, state.dx, state.dy);
  const here = lookup(table, slope);
  if (!here) {
    // No avanza: las ruedas giran en el sitio (patinaje total) con el hundimiento del empuje máximo.
    const stuck = table.climbs.at(-1);
    return {
      ...state,
      slope,
      slip: 1,
      sinkage: stuck?.sinkage ?? state.sinkage,
      maxSlope: Math.max(state.maxSlope, slope),
      maxSlip: 1,
      status: "atascado",
      motion: "adelante",
      stuckTimes: state.stuckTimes + 1,
    };
  }

  const speed = vehicle.wheelSpeed * (1 - here.slip);
  const remaining = Math.hypot(targetEast - state.east, targetNorth - state.north);
  // Avance horizontal: lo recorrido sobre la pendiente, proyectado.
  const advance = Math.min(remaining, speed * dt * Math.cos((slope * Math.PI) / 180));
  const used = speed > 0 ? advance / (speed * Math.cos((slope * Math.PI) / 180)) : dt;
  const omega = vehicle.wheelSpeed / vehicle.wheelRadius;
  const next: DriveState = {
    ...state,
    east: state.east + state.dx * advance,
    north: state.north + state.dy * advance,
    distance: state.distance + advance,
    time: state.time + used,
    energy: state.energy + vehicle.wheels * here.torque * omega * used,
    wheelAngle: state.wheelAngle + omega * used,
    slope,
    slip: here.slip,
    sinkage: here.sinkage,
    maxSlope: Math.max(state.maxSlope, slope),
    maxSlip: Math.max(state.maxSlip, here.slip),
    status: "avanzando",
    motion: "adelante",
  };
  if (remaining - advance <= ARRIVAL_M) next.status = "llego";
  return next;
}

// ---------- Conducción con mandos ----------

/** Mandos: `throttle` de −1 (marcha atrás) a 1 (adelante); `steer` de −1 (derecha) a 1 (izquierda). */
export interface DriveControls {
  throttle: number;
  steer: number;
}

export interface ManualVehicle extends DriveVehicle {
  /** Radio del círculo con el que se comprueban los choques, m. */
  radius: number;
  /** Radio mínimo de giro en marcha, m; 0 si puede girar sobre sí mismo. */
  turnRadius: number;
  /** Distancia entre el eje delantero y el trasero, y entre ruedas izquierdas y derechas, m. */
  wheelbase: number;
  track: number;
}

/** Un obstáculo, visto desde arriba como un círculo. */
export interface Obstacle {
  east: number;
  north: number;
  radius: number;
}

/** Al girar sobre sí mismo las ruedas van a esta fracción de su velocidad: es una maniobra lenta. */
export const PIVOT_SPEED = 0.35;

/** Radio de la curva con el volante a tope. Los robots que giran en el sitio trazan curvas suaves al avanzar. */
export const arcRadius = (vehicle: ManualVehicle) => Math.max(vehicle.turnRadius, 2 * vehicle.wheelbase);

/** Círculo de choque de un robot a partir de su largo y su ancho, m. */
export const collisionRadius = (length: number, width: number) => 0.42 * Math.hypot(length, width);

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const RAD = Math.PI / 180;

/** Giro sobre sí mismo, rad/s, con el volante en `steer`. */
const pivotRate = (vehicle: ManualVehicle, steer: number) => (steer * PIVOT_SPEED * vehicle.wheelSpeed) / (vehicle.track / 2);

/**
 * Avanza `dt` segundos de tiempo real con los mandos dados. Devuelve un estado nuevo.
 *
 * - Acelerando, la rueda gira a `|throttle|` de su velocidad y el robot avanza lo que el patinaje
 *   de esa pendiente le deja. Si la pendiente es más de lo que puede subir, las ruedas giran sin
 *   avanzar («atascado») hasta que se cambia de rumbo o se retrocede.
 * - Sin acelerar, un robot que puede girar sobre sí mismo lo hace con el volante.
 * - No atraviesa los obstáculos ni sale del área (`limitM`, medio lado menos un margen).
 */
export function stepManual(
  state: DriveState,
  dt: number,
  height: HeightAt,
  table: SlipTable,
  vehicle: ManualVehicle,
  controls: DriveControls,
  obstacles: readonly Obstacle[] = [],
  limitM = Infinity,
): DriveState {
  const throttle = clamp(controls.throttle, -1, 1);
  const steer = clamp(controls.steer, -1, 1);
  const heading = Math.atan2(state.dy, state.dx);
  const flat = table.climbs[0];
  const turnTo = (angle: number) => ({ dx: Math.cos(angle), dy: Math.sin(angle) });

  if (Math.abs(throttle) < 0.02) {
    const ahead = slopeAlong(height, state.east, state.north, state.dx, state.dy);
    const resting = lookup(table, 0);
    const still = { slope: ahead, slip: 0, sinkage: resting?.sinkage ?? state.sinkage, status: "listo" as const, touching: false };
    if (Math.abs(steer) < 0.02 || vehicle.turnRadius > 0) return { ...state, ...still, motion: "parado" };
    // Gira sobre sí mismo: las ruedas de un lado van hacia delante y las del otro hacia atrás.
    const omega = (PIVOT_SPEED * Math.abs(steer) * vehicle.wheelSpeed) / vehicle.wheelRadius;
    return {
      ...state,
      ...still,
      ...turnTo(heading + pivotRate(vehicle, steer) * dt),
      time: state.time + dt,
      energy: state.energy + vehicle.wheels * (flat.torque ?? 0) * omega * dt,
      motion: "girando",
    };
  }

  const direction = throttle > 0 ? 1 : -1;
  const motion: Motion = direction > 0 ? "adelante" : "atras";
  const slope = slopeAlong(height, state.east, state.north, state.dx * direction, state.dy * direction);
  const here = lookup(table, slope);
  const wheelSpeed = Math.abs(throttle) * vehicle.wheelSpeed;
  const omega = wheelSpeed / vehicle.wheelRadius;

  if (!here) {
    // Atascado: las ruedas giran en el sitio. Un robot que gira sobre sí mismo puede cambiar de rumbo.
    const last = table.climbs.at(-1);
    return {
      ...state,
      ...turnTo(heading + (vehicle.turnRadius > 0 ? 0 : pivotRate(vehicle, steer) * dt)),
      time: state.time + dt,
      energy: state.energy + vehicle.wheels * (last?.torque ?? flat.torque ?? 0) * omega * dt,
      wheelAngle: state.wheelAngle + direction * omega * dt,
      slope,
      slip: 1,
      sinkage: last?.sinkage ?? state.sinkage,
      maxSlope: Math.max(state.maxSlope, slope),
      maxSlip: 1,
      status: "atascado",
      motion,
      stuckTimes: state.stuckTimes + (state.status === "atascado" ? 0 : 1),
      touching: false,
    };
  }

  const advance = wheelSpeed * (1 - here.slip) * dt * Math.cos(slope * RAD);
  // En marcha atrás el volante gira el morro hacia el otro lado, como en un coche.
  const nextHeading = heading + (direction * steer * advance) / arcRadius(vehicle);
  const mid = (heading + nextHeading) / 2;
  const east = state.east + direction * Math.cos(mid) * advance;
  const north = state.north + direction * Math.sin(mid) * advance;

  const approaching = (obstacle: Obstacle) => {
    const after = Math.hypot(east - obstacle.east, north - obstacle.north);
    return after < vehicle.radius + obstacle.radius && after < Math.hypot(state.east - obstacle.east, state.north - obstacle.north);
  };
  const hit = obstacles.some(approaching);
  const leaving = Math.max(Math.abs(east), Math.abs(north)) > limitM && Math.max(Math.abs(east), Math.abs(north)) > Math.max(Math.abs(state.east), Math.abs(state.north));
  if (hit || leaving) {
    // Se topa y se detiene: hay que girar o retroceder. Cada tope nuevo se cuenta una vez.
    return {
      ...state,
      time: state.time + dt,
      slope,
      slip: here.slip,
      sinkage: here.sinkage,
      status: "listo",
      motion,
      collisions: state.collisions + (hit && !state.touching ? 1 : 0),
      touching: true,
    };
  }

  return {
    ...state,
    east,
    north,
    ...turnTo(nextHeading),
    distance: state.distance + advance,
    time: state.time + dt,
    energy: state.energy + vehicle.wheels * here.torque * omega * dt,
    wheelAngle: state.wheelAngle + direction * omega * dt,
    slope,
    slip: here.slip,
    sinkage: here.sinkage,
    maxSlope: Math.max(state.maxSlope, slope),
    maxSlip: Math.max(state.maxSlip, here.slip),
    status: "avanzando",
    motion,
    touching: false,
  };
}

/** Desvío a partir del cual primero gira hacia el destino y después avanza, rad. */
const TURN_FIRST_RAD = 0.6;

/**
 * Los mandos que llevan al robot hacia un punto: gira hacia él y avanza. Si está muy desviado, un
 * robot que gira sobre sí mismo lo hace parado; uno que no puede (el carro lunar) maniobra marcha atrás.
 */
export function steerToward(state: DriveState, vehicle: ManualVehicle, targetEast: number, targetNorth: number): DriveControls {
  const bearing = Math.atan2(targetNorth - state.north, targetEast - state.east);
  let error = bearing - Math.atan2(state.dy, state.dx);
  error = Math.atan2(Math.sin(error), Math.cos(error));
  if (Math.abs(error) > TURN_FIRST_RAD) {
    return vehicle.turnRadius === 0 ? { throttle: 0, steer: Math.sign(error) } : { throttle: -0.6, steer: -Math.sign(error) };
  }
  return { throttle: 1, steer: clamp(error * 2.5, -1, 1) };
}

/** Distancia horizontal del robot a un punto, m. */
export const distanceTo = (state: DriveState, east: number, north: number) => Math.hypot(east - state.east, north - state.north);
