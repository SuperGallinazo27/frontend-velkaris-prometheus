import { describe, expect, test } from "bun:test";
import { heightSampler, lookup, slopeAlong, startDrive, stepDrive } from "../src/features/mission/drive";
import type { SlipTable } from "../src/features/mission/drive";
import { gridSlopes, slopeClass } from "../src/features/mission/terrainTexture";
import { blockDescriptors, rankSpots } from "../src/features/mission/spots";
import type { TerrainGrid } from "../src/features/mission/twin";
import { slipTables, tableLimits } from "../src/features/mission/wheelLab";

/** Malla de `cells` celdas de `cell` metros con la altura que da `z(este, norte)` en metros. */
function grid(cells: number, cell: number, z: (east: number, north: number) => number): TerrainGrid {
  const points = cells + 1;
  const sizeM = cells * cell;
  const heights = new Float32Array(points * points);
  for (let r = 0; r < points; r++) {
    for (let c = 0; c < points; c++) heights[r * points + c] = z(c * cell - sizeM / 2, r * cell - sizeM / 2);
  }
  return { cells, sizeM, heights, zoom: 14, sourcePixelM: 10 };
}

describe("dónde colocar el robot", () => {
  test("los descriptores de un plano inclinado: pendiente exacta y rugosidad cero", () => {
    // Sube 10 m cada 100 m hacia el este: 5,71°.
    const plane = grid(60, 30, (east) => 1000 + east * 0.1);
    const d = blockDescriptors(plane, 0, 0, 30);
    expect(d.slope).toBeCloseTo((Math.atan(0.1) * 180) / Math.PI, 3);
    expect(d.roughness).toBeLessThan(1e-3);
    expect(d.relief).toBeCloseTo(29 * 30 * 0.1, 3);
  });

  test("ordena las ventanas por parecido con la región lunar", () => {
    // Llano al oeste, ladera de 10° al este: la región pide unos 10° de pendiente.
    const terrain = grid(600, 30, (east) => (east > 0 ? east * Math.tan((10 * Math.PI) / 180) : 0));
    const spots = rankSpots(terrain, -0.5, -78.5, { relief: 500, slope: 10, roughness: 0 });
    expect(spots).toHaveLength(36);
    expect(spots[0].east).toBeGreaterThan(0);
    expect(spots[0].slope).toBeCloseTo(10, 0);
    expect(spots.at(-1)!.east).toBeLessThan(0);
    for (let k = 1; k < spots.length; k++) expect(spots[k].distance).toBeGreaterThanOrEqual(spots[k - 1].distance);
  });
});

describe("recorrido de prueba", () => {
  const tables = slipTables("viper", "arena-seca");
  const viper = { wheels: 4, wheelRadius: 0.25, wheelSpeed: 0.1 };

  test("la tabla termina donde el robot se atasca", () => {
    const last = tables.earth.climbs.at(-1)!;
    expect(last.outcome).not.toBe("avanza");
    const limits = tableLimits(tables.earth, 0.4);
    expect(limits.steep).toBeLessThanOrEqual(limits.stuck);
    expect(lookup(tables.earth, limits.stuck + 1)).toBeNull();
    // Bajando no se calcula el frenado: se usan los valores del llano.
    expect(lookup(tables.earth, -8)).toEqual(lookup(tables.earth, 0));
    expect(lookup(tables.earth, 0)!.slip).toBe(tables.earth.climbs[0].slip!);
  });

  test("en llano llega al destino, más lento que la rueda por el patinaje", () => {
    const flat = heightSampler(grid(120, 5, () => 100));
    let state = startDrive(0, 0, 20, 0);
    for (let k = 0; k < 2000 && state.status !== "llego"; k++) state = stepDrive(state, 0.5, flat, tables.earth, viper, 20, 0);
    expect(state.status).toBe("llego");
    expect(state.distance).toBeCloseTo(20, 0);
    const slip = lookup(tables.earth, 0)!;
    // Tiempo = distancia / (velocidad de la rueda · (1 − patinaje)).
    expect(state.time).toBeCloseTo(20 / (0.1 * (1 - tables.earth.climbs[0].slip!)), -1);
    expect(state.energy).toBeGreaterThan(0);
    expect(slip.sinkage).toBeGreaterThan(0);
  });

  test("una cuesta más empinada que su límite lo deja atascado al pie", () => {
    const stuck = tableLimits(tables.earth, 0.4).stuck;
    const rise = Math.tan(((stuck + 4) * Math.PI) / 180);
    const ramp = heightSampler(grid(120, 5, (east) => (east > 10 ? (east - 10) * rise : 0)));
    let state = startDrive(-50, 0, 100, 0);
    for (let k = 0; k < 20000 && state.status !== "atascado" && state.status !== "llego"; k++) {
      state = stepDrive(state, 0.5, ramp, tables.earth, viper, 100, 0);
    }
    expect(state.status).toBe("atascado");
    expect(state.slip).toBe(1);
    expect(state.sinkage).toBeGreaterThan(0);
    expect(state.east).toBeGreaterThan(0);
    expect(state.east).toBeLessThan(15);
  });

  test("la pendiente se mide en la dirección de avance", () => {
    const tilted = heightSampler(grid(40, 5, (east) => east * 0.2));
    expect(slopeAlong(tilted, 0, 0, 1, 0)).toBeCloseTo((Math.atan(0.2) * 180) / Math.PI, 3);
    expect(slopeAlong(tilted, 0, 0, -1, 0)).toBeCloseTo((-Math.atan(0.2) * 180) / Math.PI, 3);
    expect(slopeAlong(tilted, 0, 0, 0, 1)).toBeCloseTo(0, 6);
  });

  test("las clases de pendiente del terreno siguen los límites del robot", () => {
    const hill = gridSlopes(grid(10, 10, (east) => east * Math.tan((25 * Math.PI) / 180)));
    expect(hill[5 * 11 + 5]).toBeCloseTo(25, 3);
    expect(slopeClass(hill[5 * 11 + 5], 10, 20)).toBe("stuck");
    expect(slopeClass(14, 10, 20)).toBe("steep");
    expect(slopeClass(gridSlopes(grid(10, 10, () => 5))[0], 10, 20)).toBe("ok");
  });

  test("las tablas de la Luna usan el regolito y la gravedad lunar", () => {
    const moon: SlipTable = tables.moon;
    expect(moon.climbs[0].slopeDeg).toBe(0);
    expect(tableLimits(moon, 0.4).steep).toBeGreaterThan(tableLimits(tables.earth, 0.4).steep);
  });
});
