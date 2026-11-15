import { describe, expect, test } from "bun:test";
import data from "../src/data/candidatosGlobales.json";
import terreno from "../src/data/terrenoReal.json";
import places from "../src/features/world/places.json";
import { haversineKm } from "../src/features/mission/cost";
import { terrainDistance } from "../src/features/ranking/ranking";

interface Candidate {
  latitude: number;
  longitude: number;
  area: string | null;
  country: string | null;
  relief: number;
  slope: number;
  roughness: number;
  elevation: number;
  rainMm: number;
  distance: number;
}
const regions = data.regions as Record<string, { coarse: { relief: number; slope: number; roughness: number }; candidates: Candidate[] }>;

describe("búsqueda amplia de zonas nuevas", () => {
  test("cada región lunar tiene su medida a escala gruesa y sus zonas", () => {
    for (const region of terreno.regions) {
      const entry = regions[region.id];
      expect(entry).toBeDefined();
      expect(entry.candidates.length).toBe(data.limits.top);
      // Valores posibles en la Luna a esta escala. No se comparan con los de la ficha: allí el
      // recuadro es el de la región entera y aquí, un bloque de 16 km en su centro.
      expect(entry.coarse.relief).toBeGreaterThan(5);
      expect(entry.coarse.relief).toBeLessThan(3000);
      expect(entry.coarse.slope).toBeGreaterThan(0);
      expect(entry.coarse.slope).toBeLessThan(35);
    }
    // El mar del Apolo 11 es llano y el macizo Malapert, abrupto: el orden se conserva a escala gruesa.
    expect(regions["statio-tranquillitatis"].coarse.slope).toBeLessThan(2);
    expect(regions["malapert-massif"].coarse.slope).toBeGreaterThan(10);
  });

  test("las zonas cumplen los filtros: áridas, dentro de la cobertura, separadas y lejos de la lista", () => {
    for (const entry of Object.values(regions)) {
      entry.candidates.forEach((candidate, index) => {
        expect(candidate.rainMm).toBeLessThan(data.limits.aridMm);
        expect(candidate.latitude).toBeGreaterThanOrEqual(data.coverage.latMin);
        expect(candidate.latitude).toBeLessThanOrEqual(data.coverage.latMax);
        expect(candidate.elevation).toBeGreaterThan(0);
        for (const place of places) {
          expect(haversineKm(candidate, place)).toBeGreaterThanOrEqual(data.limits.awayFromListKm - 1);
        }
        for (const other of entry.candidates.slice(index + 1)) {
          expect(haversineKm(candidate, other)).toBeGreaterThanOrEqual(data.limits.separationKm - 1);
        }
      });
    }
  });

  test("van de la más parecida a la menos, con la distancia de terreno de la aplicación", () => {
    for (const entry of Object.values(regions)) {
      const distances = entry.candidates.map((candidate) => candidate.distance);
      expect([...distances].sort((a, b) => a - b)).toEqual(distances);
      for (const candidate of entry.candidates) {
        // Los descriptores se guardan redondeados: la distancia vuelve a salir casi igual.
        expect(Math.abs(terrainDistance(candidate, entry.coarse) - candidate.distance)).toBeLessThan(0.005);
      }
    }
  });

  test("los nombres se pueden leer y las fuentes están citadas", () => {
    for (const entry of Object.values(regions)) {
      for (const candidate of entry.candidates) {
        expect(candidate.country).toBeTruthy();
        // Alfabeto latino: una comarca escrita solo en árabe o chino no se muestra.
        if (candidate.area) expect([...candidate.area].every((char) => char.codePointAt(0)! < 0x250)).toBe(true);
      }
    }
    expect(data.sources.earth.doi).toBe("10.25921/fd45-gt74");
    expect(data.sources.names.name).toContain("OpenStreetMap");
    expect(data.coverage.blocks).toBeGreaterThan(100_000);
  });

  test("lo llano encuentra parecidos casi exactos; lo más abrupto, no", () => {
    expect(regions["marius"].candidates[0].distance).toBeLessThan(0.01);
    expect(regions["malapert-massif"].candidates[0].distance).toBeGreaterThan(0.15);
  });
});
