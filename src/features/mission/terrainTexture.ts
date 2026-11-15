/**
 * Colores de pendiente para el robot: cada punto del relieve, pintado según si el robot elegido lo
 * sube con poco patinaje, patinando más del límite o no lo sube. Es la capa «Pendiente» del
 * simulador; las curvas de nivel las dibuja la propia escena 3D.
 */
import type { TerrainGrid } from "./twin";

export type SlopeClass = "ok" | "steep" | "stuck";

/** Sube con poco patinaje, patina más que el límite, o se atasca. */
export function slopeClass(slope: number, steep: number, stuck: number): SlopeClass {
  return slope >= stuck ? "stuck" : slope >= steep ? "steep" : "ok";
}

/** Colores de cada clase (RGB 0-255), los mismos de la leyenda y de la huella. */
export const CLASS_RGB: Record<SlopeClass, readonly [number, number, number]> = {
  ok: [87, 153, 97],
  steep: [217, 163, 64],
  stuck: [201, 84, 64],
};

/** Pendiente más fuerte en cada punto de la malla, en grados. */
export function gridSlopes(grid: TerrainGrid): Float32Array {
  const points = grid.cells + 1;
  const cell = grid.sizeM / grid.cells;
  const slopes = new Float32Array(points * points);
  const at = (r: number, c: number) =>
    grid.heights[Math.min(points - 1, Math.max(0, r)) * points + Math.min(points - 1, Math.max(0, c))];
  for (let r = 0; r < points; r++) {
    for (let c = 0; c < points; c++) {
      const dx = (at(r, c + 1) - at(r, c - 1)) / (2 * cell);
      const dy = (at(r + 1, c) - at(r - 1, c)) / (2 * cell);
      slopes[r * points + c] = (Math.atan(Math.hypot(dx, dy)) * 180) / Math.PI;
    }
  }
  return slopes;
}

/**
 * Lienzo cuadrado (norte arriba) con un píxel por punto de la malla, pintado con la clase de su
 * pendiente. La pendiente es la más fuerte del punto: subiendo en diagonal, el robot nota menos.
 */
export function slopeCanvas(grid: TerrainGrid, limits: { steep: number; stuck: number }): HTMLCanvasElement {
  const points = grid.cells + 1;
  const canvas = document.createElement("canvas");
  canvas.width = points;
  canvas.height = points;
  const context = canvas.getContext("2d");
  if (!context) return canvas;
  const image = context.createImageData(points, points);
  const slopes = gridSlopes(grid);
  for (let row = 0; row < points; row++) {
    for (let col = 0; col < points; col++) {
      const rgb = CLASS_RGB[slopeClass(slopes[row * points + col], limits.steep, limits.stuck)];
      // Las filas de la malla van de sur a norte; las del lienzo, de arriba (norte) abajo.
      const o = ((points - 1 - row) * points + col) * 4;
      image.data[o] = rgb[0];
      image.data[o + 1] = rgb[1];
      image.data[o + 2] = rgb[2];
      image.data[o + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
  return canvas;
}
