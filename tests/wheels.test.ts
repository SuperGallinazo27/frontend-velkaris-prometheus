import { describe, expect, test } from "bun:test";
import {
  EARTH_SOILS,
  MOON_SOIL,
  REFERENCES,
  SLIP_LIMIT,
  SOURCES,
  VEHICLES,
  soilById,
  suggestSoil,
  vehicleById,
} from "../src/features/mission/wheelData";
import { CURVE_SLOPES, compare, computeValidation, computeWheels } from "../src/features/mission/wheelLab";
import type { WheelResult } from "../src/features/mission/wheelLab";

describe("datos publicados", () => {
  test("cada vehículo y cada suelo dicen de dónde salen", () => {
    for (const vehicle of VEHICLES) expect(vehicle.sources.length).toBeGreaterThan(0);
    for (const soil of [MOON_SOIL, ...EARTH_SOILS]) expect(soil.sources.length).toBeGreaterThan(0);
    for (const source of Object.values(SOURCES)) expect(source.url).toStartWith("https://");
  });

  test("las unidades están convertidas al SI (Lunar Sourcebook, tabla 9.14)", () => {
    // 0,14 N/cm² → 1400 N/m²; 0,82 N/cm³ → 820 000 N/m³; 0,017 N/cm² → 170 Pa; 1,8 cm → 0,018 m.
    expect(MOON_SOIL.soil).toEqual({ n: 1, kc: 1400, kphi: 820_000, cohesion: 170, frictionDeg: 35, shearModulus: 0.018 });
    // Arena seca de Wong: kc 0,99 kN/m^(n+1), kφ 1528,43 kN/m^(n+2), c 1,04 kPa.
    expect(soilById("arena-seca").soil).toMatchObject({ n: 1.1, kc: 990, kphi: 1_528_430, cohesion: 1040, frictionDeg: 28 });
  });

  test("VIPER y el carro lunar tienen las medidas publicadas", () => {
    expect(vehicleById("viper")).toMatchObject({ mass: 447, wheels: 4, wheel: { radius: 0.25, width: 0.2 } });
    expect(vehicleById("lrv")).toMatchObject({ mass: 708, wheels: 4, wheel: { radius: 0.409, width: 0.23 } });
    expect(SLIP_LIMIT).toBe(0.4);
  });

  test("el suelo sugerido sigue la textura del mapa y, sin dato, no finge una sugerencia", () => {
    expect(suggestSoil({ sand: 80, silt: 12, clay: 8, bulkDensity: 1.5 })).toEqual({ id: "arena-seca", fromMap: true });
    expect(suggestSoil({ sand: 20, silt: 35, clay: 45, bulkDensity: 1.3 })).toEqual({ id: "arcilloso", fromMap: true });
    expect(suggestSoil({ sand: 53, silt: 32, clay: 15, bulkDensity: 1.42 })).toEqual({ id: "franco-arenoso", fromMap: true });
    expect(suggestSoil(null)).toEqual({ id: "arena-seca", fromMap: false });
  });
});

describe("comparación Luna y aquí", () => {
  const result = computeWheels({ vehicle: "viper", earthSoil: "arena-seca", moonSlope: 9.8, earthSlope: 13 });

  test("calcula la curva entera y las cifras de los dos mundos", () => {
    expect(result.moon.curve.map((c) => c.slopeDeg)).toEqual([...CURVE_SLOPES]);
    expect(result.earth.curve).toHaveLength(CURVE_SLOPES.length);
    expect(result.moon.typical.slopeDeg).toBe(9.8);
    expect(result.earth.typical.slopeDeg).toBe(13);
  });

  test("VIPER en el regolito estimado sube unos 15° con el 40 % de patinaje, su requisito", () => {
    expect(result.moon.maxSlope).toBeGreaterThan(13);
    expect(result.moon.maxSlope).toBeLessThan(17);
  });

  test("la frase compara las pendientes máximas", () => {
    const make = (moon: number, earth: number) =>
      ({ moon: { ...result.moon, maxSlope: moon }, earth: { ...result.earth, maxSlope: earth } }) as WheelResult;
    expect(compare(make(15, 14.2)).kind).toBe("parecido");
    expect(compare(make(15, 4)).kind).toBe("mas-dificil");
    expect(compare(make(10, 18))).toEqual({ kind: "mas-facil", difference: 8 });
  });
});

describe("comprobación contra mediciones reales", () => {
  const validation = computeValidation();

  test("el carro lunar del Apolo 15: hundimiento del orden medido y pendiente dentro de lo registrado", () => {
    // Medido: unos 1,25 cm (hasta 5-7 cm en bordes de cráteres), 2-3 % de patinaje, pendientes de 19 a 23°.
    expect(validation.apollo15.sinkageCm).toBeGreaterThan(REFERENCES.apollo15.sinkageCm * 0.5);
    expect(validation.apollo15.sinkageCm).toBeLessThan(REFERENCES.apollo15.sinkageCm * 2.5);
    expect(validation.apollo15.slipPercent).toBeLessThan(6);
    expect(validation.apollo15.maxSlopeDeg).toBeGreaterThan(REFERENCES.apollo15.maxSlopeDeg[0] - 3);
    expect(validation.apollo15.maxSlopeDeg).toBeLessThan(REFERENCES.apollo15.maxSlopeDeg[1] + 3);
  });

  test("el laboratorio SLOPE: el cálculo es conservador (se atasca antes que la prueba real)", () => {
    expect(validation.slopeLab.slopeAtLimit).toBeLessThan(REFERENCES.slopeLab.slopeAtLimit);
    expect(validation.slopeLab.slopeAtLimit).toBeGreaterThan(REFERENCES.slopeLab.slopeAtLimit - 10);
  });
});
