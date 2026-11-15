/**
 * Similitud de cada localidad con un mundo de referencia y su desglose
 * continente → país → provincia → zona. Funciones puras, sin interfaz.
 */
import type { Terrain } from "../../types/analysis";
import { terrainDistance } from "../ranking/ranking";
import type { Zone } from "./zones";

/** Nivel de similitud de una localidad con el mundo de referencia. */
export type Band = "alta" | "media" | "baja";

/** Coincidencia mínima, en %, para que la similitud sea alta o media. */
export const HIGH_MATCH = 85;
export const MID_MATCH = 60;

export const BANDS: { id: Band; name: string; range: string; terrain: string }[] = [
  { id: "alta", name: "Alta", range: `${HIGH_MATCH} % o más`, terrain: "muy parecido" },
  { id: "media", name: "Media", range: `de ${MID_MATCH} a ${HIGH_MATCH - 1} %`, terrain: "de parecido intermedio" },
  { id: "baja", name: "Baja", range: `menos de ${MID_MATCH} %`, terrain: "poco parecido" },
];

/** Nombre de cada nivel del desglose, del más amplio al más fino. */
export const LEVELS = ["Continente", "País", "Provincia", "Zona"] as const;
export const LEVEL_PLURALS = ["Continentes", "Países", "Provincias", "Zonas"] as const;

/**
 * Coincidencia de terreno, de 0 a 100 %. Sale de la distancia de terreno: 100 % es la misma forma
 * (relieve, pendiente y rugosidad iguales) y baja un punto por cada centésima de distancia. Una
 * distancia de 1 equivale a diferir a la vez 1000 m de relieve, 15° de pendiente y 100 m de
 * rugosidad: ahí, y más allá, la coincidencia es 0 %.
 *
 * Compara solo la forma del terreno. No dice nada del suelo, del clima ni de la gravedad.
 */
export function matchPercent(distance: number): number {
  return Math.round(Math.max(0, 1 - distance) * 100);
}

/** El nivel sale del porcentaje ya redondeado, para que nunca se contradigan en pantalla. */
export function bandOf(distance: number): Band {
  const percent = matchPercent(distance);
  if (percent >= HIGH_MATCH) return "alta";
  return percent >= MID_MATCH ? "media" : "baja";
}

export interface Similarity {
  band: Band;
  /** «Alta», «Media» o «Baja». */
  name: string;
  percent: number;
  /** «Similitud alta · 96 % de coincidencia». */
  text: string;
}

/** Lo que se muestra de una distancia de terreno. */
export function similarity(distance: number): Similarity {
  const band = bandOf(distance);
  const name = BANDS.find((b) => b.id === band)!.name;
  const percent = matchPercent(distance);
  return { band, name, percent, text: `Similitud ${name.toLowerCase()} · ${percent} % de coincidencia` };
}

export interface Match {
  zone: Zone;
  /** Distancia al escenario más parecido del mundo de referencia. */
  distance: number;
  scenario: Terrain;
  band: Band;
}

/** Empareja cada localidad con el escenario del mundo de referencia que más se le parece. */
export function matchZones(zones: readonly Zone[], scenarios: readonly Terrain[]): Match[] {
  if (!scenarios.length) return [];
  return zones.map((zone) => {
    let scenario = scenarios[0];
    let distance = terrainDistance(zone, scenario);
    for (const candidate of scenarios.slice(1)) {
      const d = terrainDistance(zone, candidate);
      if (d < distance) {
        distance = d;
        scenario = candidate;
      }
    }
    return { zone, distance, scenario, band: bandOf(distance) };
  });
}

export const pathOf = (zone: Zone): string[] => [zone.continent, zone.country, zone.province, zone.name];

export interface Node {
  /** Nombres desde el continente hasta este nodo. */
  path: string[];
  name: string;
  /** 0 continente, 1 país, 2 provincia, 3 zona. */
  level: number;
  /** Localidades que contiene. */
  count: number;
  latitude: number;
  longitude: number;
  /** La localidad más parecida dentro del nodo; en una zona, ella misma. */
  best: Match;
}

/** Centro de un grupo de puntos sobre la esfera (media de sus direcciones). */
export function centroid(points: readonly { latitude: number; longitude: number }[]) {
  let x = 0;
  let y = 0;
  let z = 0;
  for (const point of points) {
    const lat = (point.latitude * Math.PI) / 180;
    const lon = (point.longitude * Math.PI) / 180;
    x += Math.cos(lat) * Math.cos(lon);
    y += Math.cos(lat) * Math.sin(lon);
    z += Math.sin(lat);
  }
  const length = Math.hypot(x, y, z) || 1;
  return {
    latitude: (Math.asin(z / length) * 180) / Math.PI,
    longitude: (Math.atan2(y, x) * 180) / Math.PI,
  };
}

/**
 * El punto del grupo más cercano a su centro. El marcador de un continente o un país se ancla
 * aquí para que caiga siempre sobre un lugar real y no, por ejemplo, en medio del mar.
 */
export function anchor<T extends { latitude: number; longitude: number }>(points: readonly T[]): T {
  const center = centroid(points);
  const toRad = Math.PI / 180;
  const closeness = (point: { latitude: number; longitude: number }) =>
    Math.sin(point.latitude * toRad) * Math.sin(center.latitude * toRad) +
    Math.cos(point.latitude * toRad) *
      Math.cos(center.latitude * toRad) *
      Math.cos((point.longitude - center.longitude) * toRad);
  return points.reduce((best, point) => (closeness(point) > closeness(best) ? point : best));
}

const startsWith = (path: readonly string[], prefix: readonly string[]) =>
  prefix.every((name, i) => path[i] === name);

/** Todos los nodos de un nivel, en el orden en que aparecen sus localidades. */
export function nodesAt(matches: readonly Match[], level: number): Node[] {
  const groups = new Map<string, Match[]>();
  for (const match of matches) {
    const key = pathOf(match.zone).slice(0, level + 1).join("\u0000");
    const group = groups.get(key);
    if (group) group.push(match);
    else groups.set(key, [match]);
  }
  return [...groups.values()].map((group) => {
    const path = pathOf(group[0].zone).slice(0, level + 1);
    const place = anchor(group.map((m) => m.zone));
    return {
      path,
      name: path[level],
      level,
      count: group.length,
      latitude: place.latitude,
      longitude: place.longitude,
      best: group.reduce((a, b) => (b.distance < a.distance ? b : a)),
    };
  });
}

/** Nodos del nivel siguiente dentro de un nodo; con la ruta vacía, los continentes. */
export function childrenOf(matches: readonly Match[], path: readonly string[]): Node[] {
  if (path.length >= LEVELS.length) return [];
  return nodesAt(matches, path.length).filter((node) => startsWith(node.path, path));
}

/** El tramo más largo de la ruta que todavía existe entre las localidades dadas. */
export function trimPath(matches: readonly Match[], path: readonly string[]): string[] {
  for (let length = path.length; length > 0; length--) {
    const prefix = path.slice(0, length);
    if (matches.some((m) => startsWith(pathOf(m.zone), prefix))) return prefix;
  }
  return [];
}

/** El nodo que corresponde a una ruta, si existe. */
export function nodeOf(matches: readonly Match[], path: readonly string[]): Node | null {
  if (!path.length) return null;
  return nodesAt(matches, path.length - 1).find((node) => startsWith(node.path, path)) ?? null;
}
