import { describe, expect, test } from "bun:test";
import climate from "../src/data/climaReal.json";
import places from "../src/features/world/places.json";
import {
  LIMITS,
  adjustTemperature,
  bestWindow,
  daylightHours,
  describeMonth,
  rate,
  seasonName,
  seasonOf,
  yearProfile,
} from "../src/features/world/climate";
import type { MonthClimate, MonthProfile, Rating } from "../src/features/world/climate";

const mild = { temperature: 18, temperatureMin: 12, temperatureMax: 24, precipitation: 5, wind: 12, cloud: 20, daylight: 12 };

/** Un año con la valoración dada para cada mes. */
const yearOf = (ratings: Rating[]): MonthProfile[] =>
  ratings.map((rating, index) => ({ ...mild, index, rating, reasons: [] }));

describe("horas de luz", () => {
  test("en el ecuador hay unas doce horas todo el año", () => {
    for (let month = 0; month < 12; month++) expect(daylightHours(0, month)).toBeCloseTo(12, 1);
  });

  test("los días son largos en el verano de cada hemisferio", () => {
    expect(daylightHours(45, 5)).toBeGreaterThan(15);
    expect(daylightHours(45, 11)).toBeLessThan(9);
    expect(daylightHours(-45, 11)).toBeGreaterThan(15);
    expect(daylightHours(-45, 5)).toBeLessThan(9);
  });

  test("cerca de los polos hay noche polar y sol de medianoche", () => {
    expect(daylightHours(79.4, 11)).toBe(0);
    expect(daylightHours(79.4, 5)).toBe(24);
    expect(daylightHours(-77.5, 5)).toBe(0);
    expect(daylightHours(-77.5, 11)).toBe(24);
  });
});

describe("ajuste de la temperatura a la altitud", () => {
  test("más arriba hace más frío y más abajo, más calor", () => {
    expect(adjustTemperature(10, 1000, 2000)).toBeCloseTo(3.5, 6);
    expect(adjustTemperature(10, 1000, 0)).toBeCloseTo(16.5, 6);
    expect(adjustTemperature(10, 1000, 1000)).toBe(10);
  });

  test("sin altitud conocida no se inventa un ajuste", () => {
    expect(adjustTemperature(10, 1000, null)).toBe(10);
  });
});

describe("valoración de un mes", () => {
  test("un mes templado, seco y con luz es favorable", () => {
    expect(rate(mild)).toEqual({ rating: "favorable", reasons: [] });
  });

  test("un solo inconveniente moderado lo deja en aceptable, con su motivo", () => {
    expect(rate({ ...mild, precipitation: LIMITS.soft.precipitation })).toEqual({ rating: "aceptable", reasons: ["lluvia"] });
    expect(rate({ ...mild, temperatureMin: -8 })).toEqual({ rating: "aceptable", reasons: ["frío"] });
    expect(rate({ ...mild, temperatureMax: 35 })).toEqual({ rating: "aceptable", reasons: ["calor"] });
    expect(rate({ ...mild, wind: 28 })).toEqual({ rating: "aceptable", reasons: ["viento"] });
    expect(rate({ ...mild, daylight: 6 })).toEqual({ rating: "aceptable", reasons: ["pocas horas de luz"] });
  });

  test("un extremo lo vuelve difícil y va primero entre los motivos", () => {
    const result = rate({ ...mild, precipitation: 150, wind: 28 });
    expect(result.rating).toBe("dificil");
    expect(result.reasons).toEqual(["mucha lluvia", "viento"]);
    expect(rate({ ...mild, temperatureMin: -30, temperature: -25, temperatureMax: -20 }).rating).toBe("dificil");
    expect(rate({ ...mild, daylight: 0 }).reasons).toEqual(["casi sin luz"]);
  });

  test("tres inconvenientes moderados a la vez también lo vuelven difícil", () => {
    expect(rate({ ...mild, precipitation: 50, wind: 28 }).rating).toBe("aceptable");
    const result = rate({ ...mild, precipitation: 50, wind: 28, daylight: 6 });
    expect(result).toEqual({ rating: "dificil", reasons: ["lluvia", "viento", "pocas horas de luz"] });
  });

  test("con temperaturas bajo cero la precipitación es nieve", () => {
    const result = rate({ ...mild, temperature: -3, temperatureMin: -4, temperatureMax: -2, precipitation: 60 });
    expect(result.reasons).toEqual(["nieve"]);
  });
});

describe("mejor época", () => {
  test("elige la racha más larga de meses favorables", () => {
    const year = yearOf(["dificil", "aceptable", "favorable", "favorable", "favorable", "aceptable", "favorable", "favorable", "aceptable", "aceptable", "dificil", "dificil"]);
    expect(bestWindow(year)).toEqual({ rating: "favorable", start: 2, end: 4, length: 3 });
  });

  test("la racha puede cruzar de diciembre a enero", () => {
    const year = yearOf(["favorable", "favorable", "aceptable", "dificil", "dificil", "dificil", "dificil", "dificil", "aceptable", "aceptable", "favorable", "favorable"]);
    expect(bestWindow(year)).toEqual({ rating: "favorable", start: 10, end: 1, length: 4 });
  });

  test("sin meses favorables se queda con los aceptables; si todos son difíciles, no hay época", () => {
    const fair = yearOf(["dificil", "dificil", "aceptable", "aceptable", "dificil", "dificil", "dificil", "dificil", "dificil", "dificil", "dificil", "dificil"]);
    expect(bestWindow(fair)).toEqual({ rating: "aceptable", start: 2, end: 3, length: 2 });
    expect(bestWindow(yearOf(Array<Rating>(12).fill("dificil")))).toBeNull();
    expect(bestWindow(yearOf(Array<Rating>(12).fill("favorable")))).toEqual({ rating: "favorable", start: 0, end: 11, length: 12 });
  });
});

describe("estación del año", () => {
  test("se invierte entre hemisferios y no existe entre los trópicos", () => {
    expect(seasonName(40, 0)).toBe("Invierno");
    expect(seasonName(40, 6)).toBe("Verano");
    expect(seasonName(-40, 0)).toBe("Verano");
    expect(seasonName(-40, 6)).toBe("Invierno");
    expect(seasonName(-40, 3)).toBe("Otoño");
    expect(seasonName(-1.47, 6)).toBeNull();
  });

  test("describe el mes con la estación o con las lluvias", () => {
    const month = (precipitation: number, temperature = 15): MonthProfile => ({ ...mild, index: 10, temperature, precipitation, rating: "favorable", reasons: [] });
    expect(describeMonth(month(120), 37.75)).toBe("Otoño · mucha lluvia");
    expect(describeMonth(month(5), -23.5)).toBe("Primavera · seco");
    expect(describeMonth(month(50, -4), 65)).toBe("Otoño · algo de nieve");
    expect(describeMonth(month(120), -1.47)).toBe("Temporada de lluvias");
    expect(describeMonth(month(5), -1.47)).toBe("Temporada seca");
  });
});

describe("perfil anual", () => {
  const flat: MonthClimate[] = Array.from({ length: 12 }, () => ({ temperature: 20, range: 10, precipitation: 10, wind: 5, cloud: 30 }));

  test("convierte unidades y reparte la amplitud térmica", () => {
    const [january] = yearProfile(flat, 0, 500, 1500);
    expect(january.temperature).toBeCloseTo(13.5, 6);
    expect(january.temperatureMin).toBeCloseTo(8.5, 6);
    expect(january.temperatureMax).toBeCloseTo(18.5, 6);
    expect(january.wind).toBeCloseTo(18, 6);
    expect(january.rating).toBe("favorable");
  });
});

describe("clima real de los lugares", () => {
  test("cada lugar de la lista tiene sus doce meses, con las mismas coordenadas", () => {
    // Si se añade o se mueve un lugar en places.json hay que volver a ejecutar scripts/clima/calcular.py.
    expect(climate.sites.map((s) => s.id).sort()).toEqual(places.map((p) => p.id).sort());
    for (const place of places) {
      const site = climate.sites.find((s) => s.id === place.id)!;
      expect([site.latitude, site.longitude]).toEqual([place.latitude, place.longitude]);
      expect(site.months).toHaveLength(12);
      for (const month of site.months) {
        expect(month.temperature).toBeGreaterThan(-80);
        expect(month.temperature).toBeLessThan(50);
        expect(month.precipitation).toBeGreaterThanOrEqual(0);
        expect(month.wind).toBeGreaterThanOrEqual(0);
      }
    }
  });

  test("la temporada de cada lugar es coherente con su clima conocido", () => {
    // Atacama: seco todo el año. Islandia: el invierno es difícil. Antártida: solo el verano austral es viable.
    const atacama = seasonOf("yungay", -24.08, 1075)!;
    expect(atacama.year.every((m) => m.precipitation < 20)).toBe(true);
    expect(atacama.window?.rating).toBe("favorable");

    const iceland = seasonOf("askja", 65.03, 975)!;
    expect(iceland.year[0].rating).toBe("dificil");
    expect(iceland.year[6].rating).not.toBe("dificil");

    const antarctica = seasonOf("valles-secos-de-mcmurdo", -77.5, 1025)!;
    expect(antarctica.year[6].rating).toBe("dificil");
    expect(antarctica.year[6].reasons).toContain("casi sin luz");

    expect(seasonOf("no-existe", 0, 0)).toBeNull();
    expect(seasonOf("salar-de-uyuni", -20.13, null)!.adjusted).toBe(false);
  });
});
