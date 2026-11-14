import { describe, expect, test } from "bun:test";
import {
  EARTH_CENTER,
  MARS_CENTER,
  MOON_CENTER,
  SHOTS,
  chapterProgress,
  journeyFraction,
  latLonToVec3,
  marsLegT,
  moonLegT,
  sampleShots,
  shortestAngle,
  travelT,
  yawFacing,
} from "../src/features/landing/journey";

/** Giro en Y con el mismo convenio que Three.js. */
function rotateY([x, y, z]: readonly number[], angle: number) {
  return [
    x * Math.cos(angle) + z * Math.sin(angle),
    y,
    -x * Math.sin(angle) + z * Math.cos(angle),
  ];
}
const distance = (a: readonly number[], b: readonly number[]) =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

describe("avance por capítulos", () => {
  const centers = [450, 1350, 2250];
  test("empieza en 0 y termina en el último capítulo", () => {
    expect(chapterProgress(centers, 0)).toBe(0);
    expect(chapterProgress(centers, 450)).toBe(0);
    expect(chapterProgress(centers, 9999)).toBe(2);
  });
  test("es proporcional entre dos centros", () => {
    expect(chapterProgress(centers, 900)).toBe(0.5);
    expect(chapterProgress(centers, 1575)).toBe(1.25);
  });
  test("tolera uno o ningún capítulo y centros repetidos", () => {
    expect(chapterProgress([], 100)).toBe(0);
    expect(chapterProgress([300], 100)).toBe(0);
    expect(chapterProgress([100, 100, 200], 150)).toBe(1.5);
  });
  test("el indicador marca Tierra, Luna, Marte y el regreso a la Tierra", () => {
    expect(journeyFraction(0)).toBe(0);
    expect(journeyFraction(1)).toBe(0.25);
    expect(journeyFraction(2)).toBe(0.5);
    expect(journeyFraction(4)).toBe(1);
    expect(journeyFraction(5)).toBe(1);
    expect(journeyFraction(-1)).toBe(0);
  });
});

describe("encuadres de cámara", () => {
  test("hay un encuadre por capítulo de la portada", () =>
    expect(SHOTS).toHaveLength(6));
  test("en cada capítulo devuelve su encuadre exacto", () => {
    SHOTS.forEach((shot, i) => {
      const sampled = sampleShots(SHOTS, i);
      expect(sampled.pos).toEqual([...shot.pos]);
      expect(sampled.target).toEqual([...shot.target]);
    });
  });
  test("fuera de rango se queda en los extremos", () => {
    expect(sampleShots(SHOTS, -3).pos).toEqual([...SHOTS[0].pos]);
    expect(sampleShots(SHOTS, 99).pos).toEqual([...SHOTS[5].pos]);
  });
  test("la cámara nunca atraviesa la Tierra, la Luna ni Marte", () => {
    for (let p = 0; p <= 5; p += 0.01) {
      const { pos } = sampleShots(SHOTS, p);
      expect(distance(pos, EARTH_CENTER)).toBeGreaterThan(1.7);
      expect(distance(pos, MOON_CENTER)).toBeGreaterThan(0.8);
      expect(distance(pos, MARS_CENTER)).toBeGreaterThan(1.5);
    }
  });
});

describe("orientación de los planetas", () => {
  test("latitud y longitud caen sobre la esfera", () => {
    const [x, y, z] = latLonToVec3(-24.5, -69.2, 2);
    expect(Math.hypot(x, y, z)).toBeCloseTo(2, 10);
    expect(latLonToVec3(90, 0)[1]).toBeCloseTo(1, 10);
  });
  test("yawFacing deja la longitud pedida mirando a +Z", () => {
    for (const lon of [137.8, 77.5, -59, -180, 0]) {
      const [x, , z] = rotateY(latLonToVec3(0, lon), yawFacing(lon));
      expect(x).toBeCloseTo(0, 10);
      expect(z).toBeCloseTo(1, 10);
    }
  });
  test("el giro más corto nunca supera media vuelta", () => {
    expect(shortestAngle(0, Math.PI * 1.5)).toBeCloseTo(-Math.PI / 2, 10);
    expect(shortestAngle(0.2, 0.2 + Math.PI * 4)).toBeCloseTo(0, 10);
    expect(Math.abs(shortestAngle(-3, 3))).toBeLessThan(Math.PI);
  });
  test("la sonda va de la Tierra a la Luna, a Marte y regresa, un tramo cada vez", () => {
    expect(moonLegT(0)).toBe(0);
    expect(moonLegT(1)).toBe(1);
    // Al terminar un tramo el siguiente aún no ha empezado.
    expect(marsLegT(1.05)).toBe(0);
    expect(marsLegT(2)).toBe(1);
    expect(travelT(2.2)).toBe(0);
    expect(travelT(3)).toBeGreaterThan(0.3);
    expect(travelT(3)).toBeLessThan(0.7);
    expect(travelT(4)).toBe(1);
  });
});
