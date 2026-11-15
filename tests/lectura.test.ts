import { describe, expect, test } from "bun:test";
import data from "../src/data/lecturaTerreno.json";
import places from "../src/features/world/places.json";
import { ROCK_COVER, ROCK_SIZE, SURFACES, VEGETATION, readPhotosOf, readingOf } from "../src/features/world/terrainReading";
import type { ReadPhoto, TerrainReading } from "../src/features/world/terrainReading";

const entries = Object.entries(data.places as Record<string, { model: string | null; summary: TerrainReading | null; photos: ReadPhoto[] }>);

describe("lectura del terreno a partir de fotos", () => {
  test("cada lugar leído es de la lista y guarda con qué modelo se leyó", () => {
    expect(entries.length).toBeGreaterThanOrEqual(15);
    for (const [id, entry] of entries) {
      expect(places.some((place) => place.id === id)).toBe(true);
      if (entry.photos.length) expect(entry.model).toMatch(/^gemini-/);
    }
  });

  test("los valores están dentro de las clases definidas", () => {
    for (const [, entry] of entries) {
      const summary = entry.summary;
      if (!summary) continue;
      expect(Object.keys(SURFACES)).toContain(summary.surface);
      if (summary.secondary) {
        expect(Object.keys(SURFACES)).toContain(summary.secondary);
        expect(summary.secondary).not.toBe(summary.surface);
      }
      if (summary.rockCover) expect(Object.keys(ROCK_COVER)).toContain(summary.rockCover);
      if (summary.rockSize) expect(Object.keys(ROCK_SIZE)).toContain(summary.rockSize);
      expect(Object.keys(VEGETATION)).toContain(summary.vegetation);
      expect(summary.note.length).toBeGreaterThan(10);
    }
  });

  test("la confianza nunca pasa de lo que permiten las fotos", () => {
    for (const [, entry] of entries) {
      const summary = entry.summary;
      if (!summary) continue;
      const useful = entry.photos.filter((photo) => photo.useful).length;
      const close = entry.photos.filter((photo) => photo.close).length;
      expect(summary.usefulPhotos).toBe(useful);
      expect(summary.closePhotos).toBe(close);
      expect(summary.totalPhotos).toBe(entry.photos.length);
      expect(useful).toBeGreaterThan(0);
      if (summary.confidence === "alta") expect(useful).toBeGreaterThanOrEqual(4);
      if (summary.confidence === "media") expect(useful).toBeGreaterThanOrEqual(2);
    }
  });

  test("las rocas solo se cuentan con fotos de cerca, y sin rocas no hay tamaño", () => {
    for (const [, entry] of entries) {
      const summary = entry.summary;
      if (!summary) continue;
      if (summary.closePhotos === 0) expect(summary.rockCover).toBeNull();
      if (summary.rockCover === null || summary.rockCover === "ninguna") expect(summary.rockSize).toBeNull();
      else expect(summary.rockSize).not.toBeNull();
    }
  });

  test("sin fotos útiles no hay lectura, y cada foto lleva su autor y su licencia", () => {
    for (const [, entry] of entries) {
      if (!entry.photos.some((photo) => photo.useful)) expect(entry.summary).toBeNull();
      for (const photo of entry.photos) {
        expect(photo.page).toStartWith("https://commons.wikimedia.org/");
        expect(photo.thumbnail).toMatch(/^https:\/\/(upload|thumb)\.wikimedia\.org\//);
        expect(photo.thumbnail).not.toContain("utm_");
        expect(photo.author.length).toBeGreaterThan(0);
        expect(photo.license.length).toBeGreaterThan(0);
        expect(photo.seen.length).toBeGreaterThan(3);
        // Una foto «de cerca» también es útil.
        if (photo.close) expect(photo.useful).toBe(true);
      }
    }
  });

  test("las clases cubren rangos ordenados, y un lugar sin leer no inventa nada", () => {
    const covers = Object.values(ROCK_COVER).map((item) => item.range);
    covers.forEach((range, index) => {
      expect(range[0]).toBeLessThan(range[1]);
      if (index) expect(range[0]).toBe(covers[index - 1][1]);
    });
    const sizes = Object.values(ROCK_SIZE).map((item) => item.range);
    sizes.forEach((range, index) => {
      expect(range[0]).toBeLessThan(range[1]);
      if (index) expect(range[0]).toBe(sizes[index - 1][1]);
    });
    expect(readingOf("no-existe")).toBeNull();
    expect(readPhotosOf("no-existe")).toEqual([]);
  });

  test("lo que se ve en las fotos tiene sentido: ceniza en el Cotopaxi y el Etna", () => {
    expect(readingOf("paramo-del-cotopaxi")?.surface).toBe("ceniza");
    expect(["ceniza", "lava"]).toContain(readingOf("monte-etna")!.surface);
    expect(readingOf("salar-de-uyuni")?.surface).toBe("sal");
  });
});
