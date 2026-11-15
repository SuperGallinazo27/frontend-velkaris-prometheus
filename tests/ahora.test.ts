import { describe, expect, test } from "bun:test";
import snapshot from "../src/data/enso.json";
import { RAIN_CHECK, compareRain, rateNow, seasonOf, typicalRain } from "../src/features/world/climate";
import { ensoSentence, ensoStatus, nearNino12 } from "../src/features/world/enso";
import type { EnsoData } from "../src/features/world/enso";
import { ENSO_SNAPSHOT, fetchEnso, parseEnso } from "../src/services/enso";
import { ARCHIVE_ENDPOINT, RECENT_DAYS, fetchRecentRain, parseRecentRain, recentRainUrl } from "../src/services/recentRain";

const respond = (body: unknown, status = 200) =>
  (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

/** Las 13:00 UTC del 15 de noviembre de 2026: en Galápagos (UTC−6) son las 07:00 del día 15. */
const NOW = Date.UTC(2026, 10, 15, 13, 0);

/** Días seguidos hasta el 15 de noviembre incluido, como responde el archivo de Open-Meteo. */
function daily(values: (number | null)[], utcOffsetSeconds = -21_600) {
  const end = Date.UTC(2026, 10, 15);
  return {
    utc_offset_seconds: utcOffsetSeconds,
    daily: {
      time: values.map((_, i) => new Date(end - (values.length - 1 - i) * 86_400_000).toISOString().slice(0, 10)),
      precipitation_sum: values,
    },
  };
}

describe("lluvia real de los últimos 30 días", () => {
  test("la pide al archivo, con días de sobra y sin pasarse de hoy", () => {
    const url = new URL(recentRainUrl(-0.83, -91.17, NOW));
    expect(url.origin + url.pathname).toBe(ARCHIVE_ENDPOINT);
    expect(url.searchParams.get("end_date")).toBe("2026-11-15");
    expect(url.searchParams.get("start_date")).toBe("2026-10-14");
    expect(url.searchParams.get("daily")).toBe("precipitation_sum");
    expect(url.searchParams.get("timezone")).toBe("auto");
    expect(url.searchParams.get("latitude")).toBe("-0.8300");
    // Recién pasada la medianoche UTC todavía pide hasta ayer: el archivo rechaza fechas futuras.
    expect(new URL(recentRainUrl(0, 0, Date.UTC(2026, 10, 15, 0, 30))).searchParams.get("end_date")).toBe("2026-11-14");
  });

  test("suma los 30 días anteriores a hoy en la fecha del lugar", () => {
    // Dos días de más al principio, los 30 que cuentan y el de hoy, a medias.
    const rain = parseRecentRain(daily([5, 5, ...Array(30).fill(10), 999]), NOW);
    expect(rain.totalMm).toBe(300);
    expect(rain.days).toBe(RECENT_DAYS);
    expect(rain.from).toBe("2026-10-16");
    expect(rain.to).toBe("2026-11-14");
    expect(rain.wettestMm).toBe(10);
  });

  test("donde ya es mañana, el último día del archivo es ayer y cuenta", () => {
    // UTC+13: a las 13:00 UTC del 15 allí son las 02:00 del 16.
    const rain = parseRecentRain(daily([...Array(31).fill(1), 7], 46_800), NOW);
    expect(rain.to).toBe("2026-11-15");
    expect(rain.from).toBe("2026-10-17");
    expect(rain.totalMm).toBe(36);
  });

  test("tolera algunos días sin dato, pero no un periodo vacío", () => {
    expect(parseRecentRain(daily([null, null, ...Array(28).fill(1), 0]), NOW).days).toBe(28);
    expect(() => parseRecentRain(daily([...Array(20).fill(null), ...Array(10).fill(1), 0]), NOW)).toThrow();
    expect(() => parseRecentRain({}, NOW)).toThrow();
  });

  test("un fallo del servicio no se queda guardado", async () => {
    await expect(fetchRecentRain(1, 1, respond({}, 500), NOW)).rejects.toThrow();
    const rain = await fetchRecentRain(1, 1, respond(daily([...Array(30).fill(2), 0])), NOW);
    expect(rain.totalMm).toBe(60);
  });
});

describe("lluvia real frente a la típica", () => {
  const year = Array.from({ length: 12 }, (_, month) => ({ precipitation: month === 9 ? 31 : month === 10 ? 60 : 0 }));

  test("reparte la lluvia típica de cada mes entre sus días", () => {
    // 16 días de octubre (1 mm al día) y 14 de noviembre (2 mm al día).
    expect(typicalRain(year, "2026-10-16", "2026-11-14")).toBeCloseTo(16 + 28, 6);
    expect(typicalRain(year, "2026-11-14", "2026-10-16")).toBe(0);
  });

  test("hace falta que cambien la proporción y la cantidad", () => {
    expect(compareRain(426, 12)).toBe("mucho-mas");
    expect(compareRain(100, 60)).toBe("mas");
    expect(compareRain(70, 60)).toBe("normal");
    // En un desierto, triplicar 1 mm no es noticia.
    expect(compareRain(4, 1)).toBe("normal");
    expect(compareRain(20, 100)).toBe("menos");
    expect(compareRain(0, RAIN_CHECK.minDifferenceMm - 1)).toBe("normal");
  });

  test("Sierra Negra en noviembre: seco en promedio, difícil con la lluvia de 2026", () => {
    const season = seasonOf("sierra-negra", -0.83, 1050)!;
    const november = season.year[10];
    expect(november.rating).toBe("favorable");
    const real = rateNow(november, 426);
    expect(real.rating).toBe("dificil");
    expect(real.reasons).toContain("mucha lluvia");
    // Con la lluvia típica, la valoración no cambia.
    expect(rateNow(november, november.precipitation).rating).toBe(november.rating);
  });
});

describe("El Niño y La Niña", () => {
  const data = (values: number[]): EnsoData => ({
    fetchedAt: "2026-11-15",
    recent: values.map((oni, i) => ({ season: ["AMJ", "MJJ", "JJA", "JAS", "ASO"][i] ?? "ASO", year: 2026, oni })),
    weekly: null,
    source: ENSO_SNAPSHOT.source,
  });

  test("clasifica el estado, la intensidad y el episodio", () => {
    const strong = ensoStatus(data([0.95, 1.39, 1.8, 2.16, 2.46]))!;
    expect(strong).toMatchObject({ state: "nino", strength: "muy fuerte", episode: true, period: "agosto a octubre de 2026" });
    expect(ensoStatus(data([0.1, 0.2, 0.3, 0.4, 0.6]))).toMatchObject({ state: "nino", strength: "débil", episode: false });
    expect(ensoStatus(data([-0.6, -0.8, -1.0, -1.2, -1.6]))).toMatchObject({ state: "nina", strength: "fuerte", episode: true });
    expect(ensoStatus(data([0.2, 0.1, 0, -0.1, -0.3]))).toMatchObject({ state: "neutral", strength: null, episode: false });
    expect(ensoStatus(data([]))).toBeNull();
  });

  test("lo cuenta en una frase, y calla si no hay nada que contar", () => {
    expect(ensoSentence(ensoStatus(data([0.95, 1.39, 1.8, 2.16, 2.46]))!)).toBe(
      "El Niño muy fuerte activo: el Pacífico ecuatorial está 2,5 °C más caliente de lo normal (agosto a octubre de 2026).",
    );
    expect(ensoSentence(ensoStatus(data([-0.2, -0.3, -0.4, -0.5, -0.7]))!)).toContain("La Niña débil en desarrollo");
    expect(ensoSentence(ensoStatus(data([0, 0, 0, 0, 0]))!)).toBeNull();
  });

  test("la costa de Ecuador y Perú, con Galápagos, queda junto a la región Niño 1+2", () => {
    expect(nearNino12(-0.83, -91.17)).toBe(true); // Sierra Negra
    expect(nearNino12(-1.47, -78.87)).toBe(true); // Chimborazo
    expect(nearNino12(-16.7, -71.9)).toBe(false); // Pampa de La Joya
    expect(nearNino12(37.75, 14.99)).toBe(false); // Etna
  });

  test("la copia guardada tiene cinco trimestres y fecha", () => {
    expect(snapshot.recent).toHaveLength(5);
    expect(snapshot.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(snapshot.source.oni).toStartWith("https://www.cpc.ncep.noaa.gov/");
    expect(ensoStatus(ENSO_SNAPSHOT)).not.toBeNull();
  });

  test("sin servidor usa la copia; con servidor, su respuesta; si falla, la copia", async () => {
    expect(await fetchEnso(respond({}), undefined)).toBe(ENSO_SNAPSHOT);
    const live = {
      fetched_at: "2027-01-02",
      recent: [{ season: "OND", year: 2026, oni: 2.1 }],
      weekly: { week: "2026-12-30", nino12: { sst: 26, anomaly: 3.1 }, nino34: { sst: 29, anomaly: 2.2 } },
      source: ENSO_SNAPSHOT.source,
    };
    expect(parseEnso(live)).toMatchObject({ fetchedAt: "2027-01-02", recent: [{ oni: 2.1 }], weekly: { week: "2026-12-30" } });
    expect(() => parseEnso({ recent: [] })).toThrow();
    expect(await fetchEnso(respond({}, 503), "http://servidor.test")).toBe(ENSO_SNAPSHOT);
    expect((await fetchEnso(respond(live), "http://servidor.test/")).fetchedAt).toBe("2027-01-02");
  });
});
