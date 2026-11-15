import { describe, expect, test } from "bun:test";
import {
  MAX_SLIP,
  bekkerSinkage,
  climb,
  maxSlope,
  slipCurve,
  solveContact,
} from "../src/features/mission/terramechanics";
import type { Soil, Vehicle } from "../src/features/mission/terramechanics";

// Suelos y rueda de PRUEBA: valores del orden de los publicados, solo para comprobar el cálculo.
const loose: Soil = { n: 1, kc: 1400, kphi: 820_000, cohesion: 170, frictionDeg: 35, shearModulus: 0.0178 };
const sand: Soil = { n: 1.1, kc: 990, kphi: 1_528_430, cohesion: 1040, frictionDeg: 28, shearModulus: 0.025 };
const shape = { c1: 0.43, c2: 0.32 };
const rover: Vehicle = { mass: 447, wheels: 4, wheel: { radius: 0.25, width: 0.2 } };
const MOON = 1.62;
const EARTH = 9.81;

describe("hundimiento", () => {
  test("coincide con la fórmula cerrada de Bekker cuando no hay corte", () => {
    // Sin fricción ni cohesión y con el esfuerzo máximo en la entrada, el cálculo es el de Bekker.
    const bare = { ...loose, cohesion: 0, frictionDeg: 0 };
    for (const load of [50, 150, 400]) {
      const numeric = solveContact(rover.wheel, bare, load, 0, { c1: 0, c2: 0 })!.sinkage;
      const closed = bekkerSinkage(rover.wheel, bare, load);
      expect(Math.abs(numeric - closed) / closed).toBeLessThan(0.02);
    }
  });

  test("más carga, más hundimiento; con la gravedad lunar, mucho menos", () => {
    const light = solveContact(rover.wheel, loose, 150, 0.1, shape)!.sinkage;
    const heavy = solveContact(rover.wheel, loose, 600, 0.1, shape)!.sinkage;
    expect(heavy).toBeGreaterThan(light);
    const moon = climb(rover, loose, MOON, 0, shape).sinkage!;
    const earth = climb(rover, loose, EARTH, 0, shape).sinkage!;
    expect(moon).toBeLessThan(earth / 2);
  });

  test("si ni hundida hasta el eje sostiene la carga, la rueda se entierra", () => {
    const mud: Soil = { ...loose, kc: 10, kphi: 1000 };
    expect(solveContact(rover.wheel, mud, 5000, 0.2, shape)).toBeNull();
    expect(climb({ ...rover, mass: 4000 }, mud, EARTH, 0, shape).outcome).toBe("enterrado");
  });
});

describe("pendiente y patinaje", () => {
  test("en llano avanza con poco patinaje", () => {
    const flat = climb(rover, loose, MOON, 0, shape);
    expect(flat.outcome).toBe("avanza");
    expect(flat.slip!).toBeGreaterThan(0);
    expect(flat.slip!).toBeLessThan(0.15);
  });

  test("cuanto más empinado, más patina, hasta atascarse", () => {
    const slips = [0, 5, 10, 15].map((slope) => climb(rover, loose, MOON, slope, shape).slip!);
    for (let k = 1; k < slips.length; k++) expect(slips[k]).toBeGreaterThan(slips[k - 1]);
    expect(climb(rover, loose, MOON, 35, shape).outcome).toBe("atascado");
  });

  test("sin cohesión ni fricción no hay tracción para subir", () => {
    const slick: Soil = { ...loose, cohesion: 0, frictionDeg: 0 };
    expect(climb(rover, slick, MOON, 5, shape).outcome).toBe("atascado");
  });

  test("con hundimiento grande la tracción baja al patinar mucho, y aun así encuentra el patinaje justo", () => {
    // Robot completo en arena seca con gravedad terrestre: se hunde unos 6 cm.
    const pull = (slip: number) => solveContact(rover.wheel, sand, (rover.mass * EARTH) / 4, slip, shape)!.drawbarPull;
    expect(pull(0.5)).toBeGreaterThan(pull(MAX_SLIP));
    const flat = climb(rover, sand, EARTH, 0, shape);
    expect(flat.outcome).toBe("avanza");
    expect(pull(flat.slip!)).toBeGreaterThanOrEqual(-0.5);
  });

  test("la pendiente máxima respeta el patinaje límite", () => {
    const limit = 0.5;
    const best = maxSlope(rover, loose, MOON, limit, shape);
    expect(best).toBeGreaterThan(5);
    const below = climb(rover, loose, MOON, best - 0.5, shape);
    expect(below.outcome).toBe("avanza");
    expect(below.slip!).toBeLessThanOrEqual(limit);
    const above = climb(rover, loose, MOON, best + 0.5, shape);
    expect(above.outcome !== "avanza" || above.slip! > limit).toBe(true);
  });
});

describe("rango fiable", () => {
  test("avisa cuando el hundimiento pasa de un tercio del radio", () => {
    expect(climb(rover, loose, MOON, 0, shape).reliable).toBe(true);
    const soft: Soil = { ...sand, kphi: 300_000, kc: 200 };
    const deep = climb(rover, soft, EARTH, 0, shape);
    expect(deep.sinkage!).toBeGreaterThan(rover.wheel.radius / 3);
    expect(deep.reliable).toBe(false);
  });

  test("la curva calcula cada pendiente igual que una subida suelta", () => {
    const curve = slipCurve(rover, loose, MOON, [0, 10], shape);
    expect(curve.map((c) => c.slopeDeg)).toEqual([0, 10]);
    expect(curve[1]).toEqual(climb(rover, loose, MOON, 10, shape));
  });
});
