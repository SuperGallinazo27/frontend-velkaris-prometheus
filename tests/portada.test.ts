import { describe, expect, test } from "bun:test";
import { candidates as demoCandidates } from "../src/data/demo";
import { faceOf } from "../src/features/landing/journey";
import { TOP_PLACES, marsRegions, moonRegions, rankingFor, sceneCandidates, sceneRegions } from "../src/features/landing/portada";
import { terrainDistance } from "../src/features/ranking/ranking";
import { lunarRegions } from "../src/features/world/lunar";
import places from "../src/features/world/places.json";

describe("datos de la portada", () => {
  test("las regiones lunares son reales: una por zona, con sus valores medidos", () => {
    expect(moonRegions.map((region) => region.id)).toEqual(["haworth", "statio-tranquillitatis", "peary"]);
    for (const region of moonRegions) {
      const lunar = lunarRegions.find((item) => item.id === region.id)!;
      expect(region.world).toBe("Luna");
      expect(region).toMatchObject({ relief: lunar.relief, slope: lunar.slope, roughness: lunar.roughness });
      expect(region.context.length).toBeGreaterThan(10);
    }
    expect(new Set(moonRegions.map((region) => lunarRegions.find((item) => item.id === region.id)!.zone)).size).toBe(3);
  });

  test("con la Luna, el ranking son los tres lugares reales con más coincidencia", () => {
    for (const region of moonRegions) {
      const { rows, real, compared } = rankingFor(region);
      expect(real).toBe(true);
      expect(rows).toHaveLength(TOP_PLACES);
      expect(compared).toBeGreaterThan(30);
      expect(rows.map((row) => row.rank)).toEqual([1, 2, 3]);
      rows.forEach((row, index) => {
        // Cada lugar es de la lista y su distancia es la de la aplicación.
        expect(places.some((place) => place.id === row.site.id)).toBe(true);
        expect(row.distance).toBeCloseTo(terrainDistance(row.site, region), 10);
        if (index) expect(row.distance).toBeGreaterThanOrEqual(rows[index - 1].distance);
      });
    }
  });

  test("con Marte, el ranking sigue siendo la demostración", () => {
    const { rows, real } = rankingFor(marsRegions[0]);
    expect(real).toBe(false);
    expect(rows.map((row) => row.site.id).sort()).toEqual(demoCandidates.map((site) => site.id).sort());
  });

  test("la escena conoce cada región y cada lugar que puede salir en un ranking, sin repetirlos", () => {
    expect(sceneRegions).toHaveLength(moonRegions.length + marsRegions.length);
    const ids = sceneCandidates.map((site) => site.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const region of [...moonRegions, ...marsRegions]) {
      for (const row of rankingFor(region).rows) expect(ids).toContain(row.site.id);
    }
  });
});

describe("hacia dónde encarar la Tierra", () => {
  const fallback = { lat: 25, lon: -62 };

  test("un solo lugar: se le da la cara", () => {
    const face = faceOf([{ latitude: -16.7, longitude: -71.9 }], fallback);
    expect(face.lat).toBeCloseTo(-16.7, 6);
    expect(face.lon).toBeCloseTo(-71.9, 6);
  });

  test("varios lugares: el punto medio de sus direcciones", () => {
    const face = faceOf(
      [
        { latitude: 0, longitude: -80 },
        { latitude: 0, longitude: -60 },
      ],
      fallback,
    );
    expect(face.lat).toBeCloseTo(0, 6);
    expect(face.lon).toBeCloseTo(-70, 6);
  });

  test("sin lugares, o si se anulan entre sí, se usa la orientación de reserva", () => {
    expect(faceOf([], fallback)).toBe(fallback);
    expect(
      faceOf(
        [
          { latitude: 0, longitude: 0 },
          { latitude: 0, longitude: 180 },
        ],
        fallback,
      ),
    ).toBe(fallback);
  });
});
