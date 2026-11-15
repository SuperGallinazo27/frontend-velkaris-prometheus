import { describe, expect, test } from "bun:test";
import { statSync } from "node:fs";
import rugosidad from "../src/data/rugosidadLola.json";
import terreno from "../src/data/terrenoReal.json";

type Fine = { median: number; q1: number; q3: number; pixels: number } | null;
const regions = rugosidad.regions as Record<string, Fine>;

describe("rugosidad fina de LOLA", () => {
  test("cada región lunar tiene su valor, con cuartiles ordenados y en metros razonables", () => {
    for (const region of terreno.regions) {
      const fine = regions[region.id];
      expect(fine).not.toBeNull();
      expect(fine!.q1).toBeLessThanOrEqual(fine!.median);
      expect(fine!.median).toBeLessThanOrEqual(fine!.q3);
      // Por encima del ruido del instrumento (unos 0,15 m) y por debajo de unos pocos metros.
      expect(fine!.median).toBeGreaterThan(rugosidad.source.noiseM);
      expect(fine!.median).toBeLessThan(3);
      expect(fine!.pixels).toBeGreaterThan(100);
    }
  });

  test("lo joven y áspero sale más rugoso que el mar liso del Apolo 11", () => {
    // Aristarco es un cráter joven de bordes ásperos; el Mar de la Tranquilidad, una llanura de lava.
    expect(regions["aristarchus"]!.median).toBeGreaterThan(regions["statio-tranquillitatis"]!.median * 2);
    expect(regions["statio-tranquillitatis"]!.median).toBeLessThan(rugosidad.moonMedian);
  });

  test("la fuente es el producto oficial de NASA", () => {
    expect(rugosidad.source.url).toStartWith("https://pds-geosciences.wustl.edu/lro/");
    expect(rugosidad.source.baselineM).toBe(25);
  });
});

describe("relieve lunar de la portada", () => {
  test("la imagen existe y es liviana", () => {
    const size = statSync(new URL("../src/features/landing/luna-lola.webp", import.meta.url)).size;
    expect(size).toBeGreaterThan(50_000);
    expect(size).toBeLessThan(600_000);
  });
});
