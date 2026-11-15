/**
 * Dónde colocar el robot dentro del área del lugar: se reparte el recuadro de 18 km en ventanas
 * de 3 km y se ordenan por su parecido de terreno con la región lunar, con la misma receta que la
 * comparación entre lugares (scripts/terreno/descriptores.py) y la misma distancia.
 *
 * El relieve sale de las teselas Terrarium del gemelo digital, no del Copernicus del análisis:
 * los valores pueden diferir un poco de los de la ficha, pero el orden de las ventanas es real.
 */
import { terrainDistance } from "../ranking/ranking";
import { offsetToLatLon } from "./twin";
import type { TerrainGrid } from "./twin";

export interface Descriptors {
  relief: number;
  slope: number;
  roughness: number;
}

export interface Spot extends Descriptors {
  /** Centro de la ventana en metros desde el centro del área (este y norte). */
  east: number;
  north: number;
  latitude: number;
  longitude: number;
  /** Lado de la ventana, en metros. */
  sizeM: number;
  /** Distancia de terreno a la región lunar: cuanto menor, más parecida. */
  distance: number;
}

/**
 * Relieve (máximo − mínimo), pendiente media (diferencias centrales de los 4 vecinos, en grados) y
 * rugosidad (RMS de los residuos frente al plano de mínimos cuadrados) de un bloque de la malla.
 * Filas de sur a norte y columnas de oeste a este, como en `TerrainGrid`.
 */
export function blockDescriptors(grid: TerrainGrid, row0: number, col0: number, size: number): Descriptors {
  const points = grid.cells + 1;
  const cell = grid.sizeM / grid.cells;
  const at = (row: number, col: number) => grid.heights[row * points + col];
  let min = Infinity;
  let max = -Infinity;
  let slopeSum = 0;
  let slopeCount = 0;
  // Plano z = a + b·x + c·y con x e y centrados: los coeficientes se separan.
  let n = 0;
  let sumZ = 0;
  let sumX = 0;
  let sumY = 0;
  for (let r = row0; r < row0 + size; r++) {
    for (let c = col0; c < col0 + size; c++) {
      const z = at(r, c);
      if (z < min) min = z;
      if (z > max) max = z;
      n++;
      sumZ += z;
      sumX += c;
      sumY += r;
      if (r > 0 && r < points - 1 && c > 0 && c < points - 1) {
        const dx = (at(r, c + 1) - at(r, c - 1)) / (2 * cell);
        const dy = (at(r + 1, c) - at(r - 1, c)) / (2 * cell);
        slopeSum += (Math.atan(Math.hypot(dx, dy)) * 180) / Math.PI;
        slopeCount++;
      }
    }
  }
  const meanZ = sumZ / n;
  const meanX = sumX / n;
  const meanY = sumY / n;
  let sxx = 0;
  let syy = 0;
  let sxz = 0;
  let syz = 0;
  for (let r = row0; r < row0 + size; r++) {
    for (let c = col0; c < col0 + size; c++) {
      const x = c - meanX;
      const y = r - meanY;
      const z = at(r, c) - meanZ;
      sxx += x * x;
      syy += y * y;
      sxz += x * z;
      syz += y * z;
    }
  }
  // En una ventana cuadrada completa, x e y centrados son independientes (Σxy = 0).
  const b = sxx ? sxz / sxx : 0;
  const c = syy ? syz / syy : 0;
  let residuals = 0;
  for (let r = row0; r < row0 + size; r++) {
    for (let col = col0; col < col0 + size; col++) {
      const fit = meanZ + b * (col - meanX) + c * (r - meanY);
      residuals += (at(r, col) - fit) ** 2;
    }
  }
  return {
    relief: max - min,
    slope: slopeCount ? slopeSum / slopeCount : 0,
    roughness: Math.sqrt(residuals / n),
  };
}

/**
 * Las ventanas de `windowM` metros que caben en el área, ordenadas de más a menos parecida a
 * `target`. Ventanas contiguas, sin solaparse, como en el análisis.
 */
export function rankSpots(grid: TerrainGrid, latitude: number, longitude: number, target: Descriptors, windowM = 3000): Spot[] {
  const cell = grid.sizeM / grid.cells;
  const size = Math.max(3, Math.round(windowM / cell));
  const across = Math.floor((grid.cells + 1) / size);
  const spots: Spot[] = [];
  for (let wr = 0; wr < across; wr++) {
    for (let wc = 0; wc < across; wc++) {
      const descriptors = blockDescriptors(grid, wr * size, wc * size, size);
      const east = (wc * size + size / 2) * cell - grid.sizeM / 2;
      const north = (wr * size + size / 2) * cell - grid.sizeM / 2;
      const at = offsetToLatLon(latitude, longitude, east, north);
      spots.push({
        ...descriptors,
        east,
        north,
        latitude: at.latitude,
        longitude: at.longitude,
        sizeM: size * cell,
        distance: terrainDistance(descriptors, target),
      });
    }
  }
  return spots.sort((a, b) => a.distance - b.distance);
}
