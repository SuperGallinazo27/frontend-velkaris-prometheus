/**
 * Gemelo digital del terreno de un lugar: una malla con su relieve real, lista para un simulador.
 *
 * La elevación sale de las teselas Terrarium de Mapzen (AWS Open Data), las mismas que usa el mapa
 * 3D. Se leen en el navegador, se muestrean en una malla cuadrada y se exportan como:
 * - `.obj`: malla de triángulos en metros (Blender, Gazebo, Isaac Sim, Unity).
 * - `.json`: mapa de alturas, pendientes y gravedad lunar, para montar el entorno de simulación.
 *
 * Es la forma del terreno, no sus propiedades mecánicas: fricción, cohesión y densidad quedan
 * vacías a propósito, porque no hay mediciones de campo. Nada aquí se inventa.
 */

export const TERRAIN_TILES = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";
export const TERRAIN_SOURCE = {
  name: "Mapzen Terrarium terrain tiles (AWS Open Data)",
  url: "https://registry.opendata.aws/terrain-tiles/",
};

export const RESOLUTIONS = [
  { cells: 64, name: "Estándar" },
  { cells: 128, name: "Alta" },
  { cells: 256, name: "Ultra" },
] as const;

export const MOON_GRAVITY = 1.62;
export const EARTH_GRAVITY = 9.81;

const TILE_PX = 256;
const EARTH_CIRCUMFERENCE_M = 40_075_016.686;
const M_PER_DEGREE = 111_320;
const MAX_ZOOM = 14;

/** Altura en metros de un píxel Terrarium. */
export const decodeTerrarium = (r: number, g: number, b: number) => r * 256 + g + b / 256 - 32768;

/** Posición en teselas (con decimales) de una longitud y una latitud en la proyección web. */
export const lonToTile = (longitude: number, zoom: number) => ((longitude + 180) / 360) * 2 ** zoom;
export function latToTile(latitude: number, zoom: number): number {
  const rad = (latitude * Math.PI) / 180;
  return ((1 - Math.asinh(Math.tan(rad)) / Math.PI) / 2) * 2 ** zoom;
}

/** El zoom más bajo cuyos píxeles ya son tan finos como una celda de la malla a esa latitud. */
export function zoomFor(latitude: number, cellM: number): number {
  const ground = EARTH_CIRCUMFERENCE_M * Math.cos((latitude * Math.PI) / 180);
  const zoom = Math.ceil(Math.log2(ground / (TILE_PX * cellM)));
  return Math.max(0, Math.min(MAX_ZOOM, zoom));
}

/** Coordenadas de un punto a `east` y `north` metros del centro (aproximación plana local). */
export function offsetToLatLon(latitude: number, longitude: number, east: number, north: number) {
  return {
    latitude: latitude + north / M_PER_DEGREE,
    longitude: longitude + east / (M_PER_DEGREE * Math.cos((latitude * Math.PI) / 180)),
  };
}

export interface TerrainGrid {
  /** Celdas por lado; la malla tiene `cells + 1` puntos por lado. */
  cells: number;
  /** Lado del área, en metros. */
  sizeM: number;
  /** Alturas en metros sobre el nivel del mar: filas de sur a norte, columnas de oeste a este. */
  heights: Float32Array;
  /** Zoom de las teselas usadas y tamaño de su píxel sobre el terreno. */
  zoom: number;
  sourcePixelM: number;
}

/** Lector de alturas en coordenadas de píxel global (tesela × 256) a un zoom dado. */
export type HeightReader = (px: number, py: number) => number;

/** Altura interpolada entre los cuatro píxeles que rodean un punto. */
export function bilinear(read: HeightReader, px: number, py: number): number {
  const x0 = Math.floor(px - 0.5);
  const y0 = Math.floor(py - 0.5);
  const tx = px - 0.5 - x0;
  const ty = py - 0.5 - y0;
  const top = read(x0, y0) * (1 - tx) + read(x0 + 1, y0) * tx;
  const bottom = read(x0, y0 + 1) * (1 - tx) + read(x0 + 1, y0 + 1) * tx;
  return top * (1 - ty) + bottom * ty;
}

/** Muestrea el área cuadrada en una malla de `cells + 1` puntos por lado. */
export function sampleGrid(
  read: HeightReader,
  latitude: number,
  longitude: number,
  sizeM: number,
  cells: number,
  zoom: number,
): Float32Array {
  const points = cells + 1;
  const heights = new Float32Array(points * points);
  for (let row = 0; row < points; row++) {
    for (let col = 0; col < points; col++) {
      const east = (col / cells - 0.5) * sizeM;
      const north = (row / cells - 0.5) * sizeM;
      const at = offsetToLatLon(latitude, longitude, east, north);
      heights[row * points + col] = bilinear(read, lonToTile(at.longitude, zoom) * TILE_PX, latToTile(at.latitude, zoom) * TILE_PX);
    }
  }
  return heights;
}

/** Teselas que cubren el área, con un píxel de margen para la interpolación. */
export function tilesFor(latitude: number, longitude: number, sizeM: number, zoom: number) {
  const half = sizeM / 2;
  const northWest = offsetToLatLon(latitude, longitude, -half, half);
  const southEast = offsetToLatLon(latitude, longitude, half, -half);
  const margin = 2 / TILE_PX;
  const x0 = Math.floor(lonToTile(northWest.longitude, zoom) - margin);
  const x1 = Math.floor(lonToTile(southEast.longitude, zoom) + margin);
  const y0 = Math.floor(latToTile(northWest.latitude, zoom) - margin);
  const y1 = Math.floor(latToTile(southEast.latitude, zoom) + margin);
  return { x0, x1, y0, y1 };
}

async function loadTile(url: string): Promise<Uint8ClampedArray> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Tesela de elevación ${response.status}`);
  const bitmap = await createImageBitmap(await response.blob());
  const canvas = document.createElement("canvas");
  canvas.width = TILE_PX;
  canvas.height = TILE_PX;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Este navegador no puede leer las teselas de elevación");
  context.drawImage(bitmap, 0, 0);
  return context.getImageData(0, 0, TILE_PX, TILE_PX).data;
}

/** Descarga las teselas del área y devuelve la malla de alturas. */
export async function fetchTerrain(latitude: number, longitude: number, sizeM: number, cells: number): Promise<TerrainGrid> {
  const zoom = zoomFor(latitude, sizeM / cells);
  const { x0, x1, y0, y1 } = tilesFor(latitude, longitude, sizeM, zoom);
  const columns = x1 - x0 + 1;
  const rows = y1 - y0 + 1;
  if (columns * rows > 36) throw new Error("El área pide demasiadas teselas de elevación");

  const world = 2 ** zoom;
  const tiles = await Promise.all(
    Array.from({ length: columns * rows }, (_, index) => {
      const x = x0 + (index % columns);
      const y = y0 + Math.floor(index / columns);
      // La longitud da la vuelta al mundo; la latitud no.
      const wrapped = ((x % world) + world) % world;
      return loadTile(TERRAIN_TILES.replace("{z}", String(zoom)).replace("{x}", String(wrapped)).replace("{y}", String(y)));
    }),
  );

  const read: HeightReader = (px, py) => {
    const tx = Math.min(columns - 1, Math.max(0, Math.floor(px / TILE_PX) - x0));
    const ty = Math.min(rows - 1, Math.max(0, Math.floor(py / TILE_PX) - y0));
    const ix = Math.min(TILE_PX - 1, Math.max(0, Math.floor(px) - (x0 + tx) * TILE_PX));
    const iy = Math.min(TILE_PX - 1, Math.max(0, Math.floor(py) - (y0 + ty) * TILE_PX));
    const data = tiles[ty * columns + tx];
    const offset = (iy * TILE_PX + ix) * 4;
    return decodeTerrarium(data[offset], data[offset + 1], data[offset + 2]);
  };

  return {
    cells,
    sizeM,
    heights: sampleGrid(read, latitude, longitude, sizeM, cells, zoom),
    zoom,
    sourcePixelM: (EARTH_CIRCUMFERENCE_M * Math.cos((latitude * Math.PI) / 180)) / (TILE_PX * world),
  };
}

export interface TerrainStats {
  minM: number;
  maxM: number;
  reliefM: number;
  /** Pendiente entre puntos vecinos de la malla, en grados. */
  slopeMeanDeg: number;
  slopeP95Deg: number;
  slopeMaxDeg: number;
}

export function terrainStats(grid: TerrainGrid): TerrainStats {
  const points = grid.cells + 1;
  const cell = grid.sizeM / grid.cells;
  let min = Infinity;
  let max = -Infinity;
  for (const height of grid.heights) {
    if (height < min) min = height;
    if (height > max) max = height;
  }
  const slopes: number[] = [];
  for (let row = 1; row < points - 1; row++) {
    for (let col = 1; col < points - 1; col++) {
      const at = row * points + col;
      const dx = (grid.heights[at + 1] - grid.heights[at - 1]) / (2 * cell);
      const dy = (grid.heights[at + points] - grid.heights[at - points]) / (2 * cell);
      slopes.push((Math.atan(Math.hypot(dx, dy)) * 180) / Math.PI);
    }
  }
  slopes.sort((a, b) => a - b);
  const mean = slopes.reduce((sum, value) => sum + value, 0) / Math.max(1, slopes.length);
  return {
    minM: min,
    maxM: max,
    reliefM: max - min,
    slopeMeanDeg: mean,
    slopeP95Deg: slopes[Math.floor(slopes.length * 0.95)] ?? 0,
    slopeMaxDeg: slopes.at(-1) ?? 0,
  };
}

export interface TwinSite {
  name: string;
  latitude: number;
  longitude: number;
}

/** Región lunar con la que se comparó el lugar, si la hay. */
export interface TwinReference {
  name: string;
  relief: number;
  slope: number;
  roughness: number;
}

/**
 * Malla Wavefront OBJ. X apunta al este, Y al norte y Z hacia arriba, en metros y sin exagerar.
 * El origen está en el centro del área y Z = 0 en su punto más bajo.
 */
export function toObj(grid: TerrainGrid, site: TwinSite, generatedAt: string): string {
  const points = grid.cells + 1;
  const cell = grid.sizeM / grid.cells;
  const stats = terrainStats(grid);
  const lines = [
    "# PROMETHEUS - gemelo digital de terreno",
    `# Lugar: ${site.name} (${site.latitude.toFixed(4)}, ${site.longitude.toFixed(4)})`,
    `# Area: ${grid.sizeM} m x ${grid.sizeM} m, ${grid.cells} x ${grid.cells} celdas de ${cell.toFixed(1)} m`,
    "# Unidades: metros. Ejes: X este, Y norte, Z arriba. Relieve real, sin exagerar.",
    `# Origen: centro del area; Z = 0 corresponde a ${stats.minM.toFixed(1)} m sobre el nivel del mar.`,
    `# Elevacion: ${TERRAIN_SOURCE.name}, ${TERRAIN_SOURCE.url}`,
    "# Solo la forma del terreno: sin propiedades mecanicas del suelo.",
    `# Generado: ${generatedAt}`,
    "o terreno",
  ];
  for (let row = 0; row < points; row++) {
    for (let col = 0; col < points; col++) {
      const x = (col / grid.cells - 0.5) * grid.sizeM;
      const y = (row / grid.cells - 0.5) * grid.sizeM;
      const z = grid.heights[row * points + col] - stats.minM;
      lines.push(`v ${x.toFixed(2)} ${y.toFixed(2)} ${z.toFixed(2)}`);
    }
  }
  // Dos triángulos por celda, en sentido antihorario visto desde arriba.
  for (let row = 0; row < grid.cells; row++) {
    for (let col = 0; col < grid.cells; col++) {
      const a = row * points + col + 1;
      const b = a + 1;
      const c = a + points;
      const d = c + 1;
      lines.push(`f ${a} ${b} ${d}`, `f ${a} ${d} ${c}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

/** Paquete para montar el entorno de simulación: mapa de alturas, pendientes y gravedad. */
export function toPackage(grid: TerrainGrid, site: TwinSite, reference: TwinReference | null, generatedAt: string) {
  const stats = terrainStats(grid);
  const round = (value: number, digits = 1) => Number(value.toFixed(digits));
  return {
    format: "prometheus-terrain-twin/1",
    generated_at: generatedAt,
    site: { name: site.name, latitude: site.latitude, longitude: site.longitude },
    area: { size_m: grid.sizeM, cells: grid.cells, cell_m: round(grid.sizeM / grid.cells, 2) },
    axes: "x este, y norte, z arriba; alturas en metros sobre el nivel del mar",
    elevation: {
      min_m: round(stats.minM),
      max_m: round(stats.maxM),
      relief_m: round(stats.reliefM),
      source: TERRAIN_SOURCE.name,
      source_url: TERRAIN_SOURCE.url,
      source_pixel_m: round(grid.sourcePixelM),
    },
    slope: {
      mean_deg: round(stats.slopeMeanDeg),
      p95_deg: round(stats.slopeP95Deg),
      max_deg: round(stats.slopeMaxDeg),
      baseline_m: round((grid.sizeM / grid.cells) * 2, 1),
    },
    gravity: { moon_m_s2: MOON_GRAVITY, earth_m_s2: EARTH_GRAVITY },
    // Sin ensayos de campo no hay valores: se dejan vacíos en lugar de inventarlos.
    physics: {
      friction_coefficient: null,
      cohesion_kpa: null,
      bulk_density_kg_m3: null,
      note: "Sin medición de campo. Definir con ensayos geotécnicos del sitio antes de simular tracción o hundimiento.",
    },
    lunar_reference: reference && {
      region: reference.name,
      relief_m: reference.relief,
      slope_deg: reference.slope,
      roughness_m: reference.roughness,
      note: "Mediana de ventanas de 3 km a 30 m (LOLA). Sirve para comparar la forma del terreno, no para fijar la física.",
    },
    heightmap: {
      rows: grid.cells + 1,
      cols: grid.cells + 1,
      order: "filas de sur a norte, columnas de oeste a este",
      heights_m: Array.from(grid.heights, (height) => round(height)),
    },
  };
}

/** Nombre de archivo sin acentos ni espacios. */
export function fileSlug(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Entrega un archivo generado en el navegador. */
export function download(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  // El navegador necesita un momento para empezar la descarga antes de soltar la dirección.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
