import { describe, expect, test } from "bun:test";
import { HOME_DISTANCE, MAX_DISTANCE, MIN_DISTANCE, distanceFor, levelAt } from "../src/features/world/view";

describe("acercamiento y nivel de desglose", () => {
  test("al acercarse se pasa de continentes a zonas", () => {
    expect(levelAt(HOME_DISTANCE)).toBe(0);
    expect(levelAt(MAX_DISTANCE)).toBe(0);
    expect(levelAt(MIN_DISTANCE)).toBe(3);
    const levels = [5, 3.2, 2.2, 1.5].map(levelAt);
    expect(levels).toEqual([0, 1, 2, 3]);
  });

  test("elegir un nodo acerca lo justo para ver el nivel siguiente", () => {
    // Profundidad de la ruta elegida: 0 nada, 1 continente, 2 país, 3 provincia, 4 zona.
    expect([0, 1, 2, 3, 4].map((depth) => levelAt(distanceFor(depth)))).toEqual([0, 1, 2, 3, 3]);
    expect(distanceFor(4)).toBeLessThan(distanceFor(3));
    expect(distanceFor(4)).toBeGreaterThanOrEqual(MIN_DISTANCE);
    expect(distanceFor(99)).toBe(distanceFor(4));
  });
});
