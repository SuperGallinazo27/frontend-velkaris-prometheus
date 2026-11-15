/**
 * Lector mínimo de TopoJSON: convierte los países de `world-atlas` (Natural Earth, dominio público)
 * en anillos de [longitud, latitud]. Solo cubre lo que usa el mapa: polígonos y multipolígonos.
 */
export type Position = [number, number];
export type Ring = Position[];

interface TopoGeometry {
  type: string;
  /** Polygon: anillos de índices de arco. MultiPolygon: polígonos de anillos. */
  arcs?: number[][] | number[][][];
  id?: string | number;
  properties?: { name?: string };
}

export interface Topology {
  type: string;
  arcs: number[][][];
  transform?: { scale: [number, number]; translate: [number, number] };
  objects: Record<string, { type: string; geometries: TopoGeometry[] }>;
}

export interface Shape {
  name: string;
  /** Todos los anillos del país: contornos y huecos. */
  rings: Ring[];
}

/** Arcos en coordenadas absolutas. Con `transform`, vienen cuantizados y como diferencias. */
export function decodeArcs(topology: Topology): Ring[] {
  const { transform } = topology;
  return topology.arcs.map((arc) => {
    let x = 0;
    let y = 0;
    return arc.map(([dx, dy]): Position => {
      if (!transform) return [dx, dy];
      x += dx;
      y += dy;
      return [x * transform.scale[0] + transform.translate[0], y * transform.scale[1] + transform.translate[1]];
    });
  });
}

/** Une los arcos de un anillo. Un índice negativo ~i es el arco i recorrido al revés. */
function ringOf(indices: readonly number[], arcs: readonly Ring[]): Ring {
  const ring: Ring = [];
  for (const index of indices) {
    const arc = index < 0 ? [...arcs[~index]].reverse() : arcs[index];
    // El primer punto de cada arco repite el último del anterior.
    ring.push(...(ring.length ? arc.slice(1) : arc));
  }
  return ring;
}

export function shapesOf(topology: Topology, objectName: string): Shape[] {
  const arcs = decodeArcs(topology);
  const object = topology.objects[objectName];
  if (!object) return [];
  return object.geometries.flatMap((geometry) => {
    const polygons =
      geometry.type === "Polygon"
        ? [geometry.arcs as number[][]]
        : geometry.type === "MultiPolygon"
          ? (geometry.arcs as number[][][])
          : [];
    if (!polygons.length) return [];
    return [
      {
        name: geometry.properties?.name ?? String(geometry.id ?? ""),
        rings: polygons.flatMap((polygon) => polygon.map((ring) => ringOf(ring, arcs))),
      },
    ];
  });
}
