/**
 * Relación entre la distancia de la cámara al globo y el nivel de desglose que se muestra.
 * El radio del globo es 1; la distancia se mide desde su centro.
 */

/** Vista inicial: el globo completo. */
export const HOME_DISTANCE = 3.9;
export const MIN_DISTANCE = 1.16;
export const MAX_DISTANCE = 6.6;

/** Por debajo de cada límite se pasa al nivel siguiente: continente → país → provincia → zona. */
const LEVEL_LIMITS = [3.3, 2.35, 1.7];

/** Nivel de desglose visible a una distancia: 0 continentes … 3 zonas. */
export function levelAt(distance: number): number {
  return LEVEL_LIMITS.filter((limit) => distance < limit).length;
}

/** Distancia a la que vuela la cámara al elegir un nodo, según la profundidad de su ruta. */
const FLIGHT_DISTANCES = [HOME_DISTANCE, 2.8, 2, 1.45, 1.28];

/**
 * Distancia para mostrar lo que hay dentro de un nodo: con 1 (un continente) se ven sus países,
 * con 3 (una provincia) sus zonas y con 4 (una zona) el lugar de cerca.
 */
export function distanceFor(depth: number): number {
  return FLIGHT_DISTANCES[Math.min(Math.max(depth, 0), FLIGHT_DISTANCES.length - 1)];
}
