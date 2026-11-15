import { describe, expect, test } from "bun:test";
import moon from "../src/data/temperaturaLuna.json";
import earth from "../src/data/temperaturaSuelo.json";
import terreno from "../src/data/terrenoReal.json";
import { QUARTER_NAMES, groundOf, moonGroundOf, quarterOfMonth } from "../src/features/world/ground";
import places from "../src/features/world/places.json";

describe("temperatura del suelo aquí (MODIS)", () => {
  test("cada lugar de la lista tiene día y noche de los cuatro trimestres", () => {
    for (const place of places) {
      const ground = groundOf(place.id);
      expect(ground).not.toBeNull();
      expect(ground!.quarters).toHaveLength(QUARTER_NAMES.length);
      for (const quarter of ground!.quarters) {
        expect(quarter.day).not.toBeNull();
        expect(quarter.night).not.toBeNull();
        // En la Tierra, entre −90 y 75 °C; y el día no es más frío que la noche (salvo en la noche polar, casi iguales).
        expect(quarter.day!).toBeGreaterThan(-90);
        expect(quarter.day!).toBeLessThan(75);
        expect(quarter.swing!).toBeGreaterThan(-2);
      }
    }
  });

  test("los valores tienen sentido: desierto caliente, Ártico frío, estaciones opuestas", () => {
    const atacama = groundOf("yungay")!;
    const arctic = groundOf("crater-haughton")!;
    expect(atacama.hottest!.value).toBeGreaterThan(40);
    expect(arctic.coldest!.value).toBeLessThan(-30);
    // El verano del sur cae en enero–marzo o en octubre–diciembre; el del norte, en julio–septiembre.
    expect([0, 3]).toContain(atacama.hottest!.quarter);
    expect(groundOf("valle-de-la-muerte")!.hottest!.quarter).toBe(2);
    expect(atacama.widestSwing!).toBeGreaterThan(25);
  });

  test("un lugar que no está en la tabla no inventa datos", () => {
    expect(groundOf("no-existe")).toBeNull();
    expect(earth.source.resolutionM).toBe(1000);
  });

  test("cada mes cae en su trimestre", () => {
    expect([0, 2, 3, 10, 11].map(quarterOfMonth)).toEqual([0, 0, 1, 3, 3]);
  });
});

describe("temperatura del suelo en la Luna (Diviner)", () => {
  test("cada región lunar tiene su máxima y su mínima", () => {
    for (const region of terreno.regions) {
      const ground = moonGroundOf(region.id);
      expect(ground).not.toBeNull();
      expect(ground!.max).toBeGreaterThan(ground!.min);
      // Entre el fondo más frío medido (unos −250 °C) y el mediodía ecuatorial (unos 125 °C).
      expect(ground!.min).toBeGreaterThan(-255);
      expect(ground!.max).toBeLessThan(130);
    }
  });

  test("el ecuador se calienta mucho más que los polos, y la noche lunar es más fría que cualquier lugar de la Tierra", () => {
    const equator = moonGroundOf("statio-tranquillitatis")!;
    const pole = moonGroundOf("haworth")!;
    expect(equator.max).toBeGreaterThan(100);
    expect(pole.max).toBeLessThan(0);
    expect(equator.min).toBeLessThan(-150);
    expect(equator.swing).toBeGreaterThan(250);
    expect(moon.source.url).toStartWith("https://pds-geosciences.wustl.edu/lro/");
  });
});
