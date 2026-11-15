import { describe, expect, test } from "bun:test";
import { compareRain, rateToday, seasonOf } from "../src/features/world/climate";
import { clockAt, clockOf, dayLabel, differenceText, hoursAhead, zoneName } from "../src/features/world/placeTime";
import {
  BASELINE_FIRST_YEAR,
  BASELINE_MIN_YEARS,
  BASELINE_YEARS,
  baselineUrl,
  baselineWindows,
  fetchRainBaseline,
  parseWindowTotal,
  summarize,
} from "../src/services/rainBaseline";
import { ARCHIVE_ENDPOINT } from "../src/services/recentRain";
import { parseWeather } from "../src/services/weather";

const respond = (body: unknown, status = 200) =>
  (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe("valoración de hoy con datos reales", () => {
  const november = seasonOf("sierra-negra", -0.83, 1050)!.year[10];

  test("el noviembre típico de Sierra Negra es favorable; el de 2026, difícil", () => {
    expect(november.rating).toBe("favorable");
    const today = rateToday(november, { rain30dMm: 409, temperatureMin: 19, temperatureMax: 24, wind: 6, ground: "embarrado" });
    expect(today.rating).toBe("dificil");
    // El barro va primero: es lo que impide trabajar aunque hoy no llueva.
    expect(today.reasons).toEqual(["terreno embarrado", "mucha lluvia en 30 días"]);
  });

  test("un suelo embarrado hace el día difícil aunque haya llovido poco en el mes", () => {
    const today = rateToday(november, { rain30dMm: 10, ground: "embarrado" });
    expect(today).toEqual({ rating: "dificil", reasons: ["terreno embarrado"] });
  });

  test("la nieve en el suelo deja el día, como mucho, en aceptable", () => {
    expect(rateToday(november, { rain30dMm: 5, ground: "nevado" })).toEqual({ rating: "aceptable", reasons: ["nieve en el suelo"] });
    // El suelo húmedo, helado o seco no cambia la valoración por sí solo.
    for (const ground of ["seco", "humedo", "helado"] as const) {
      expect(rateToday(november, { rain30dMm: 5, ground }).rating).toBe("favorable");
    }
  });

  test("usa la temperatura y el viento de hoy cuando llegan", () => {
    expect(rateToday(november, { temperatureMin: 20, temperatureMax: 41 })).toEqual({ rating: "dificil", reasons: ["calor extremo"] });
    expect(rateToday(november, { wind: 30 }).reasons).toEqual(["viento"]);
    expect(rateToday(november, { temperatureMin: -8, temperatureMax: 3 }).reasons).toEqual(["frío"]);
  });

  test("sin datos reales devuelve la valoración típica, sin cambiar sus motivos", () => {
    expect(rateToday(november, {})).toEqual({ rating: november.rating, reasons: november.reasons });
    // Un mes típicamente lluvioso no se rotula «en 30 días» si la lluvia real no llegó.
    const february = seasonOf("sierra-negra", -0.83, 1050)!.year[1];
    expect(rateToday(february, {}).reasons).toEqual(february.reasons);
    expect(rateToday(february, { rain30dMm: 210 }).reasons).toContain("mucha lluvia en 30 días");
  });
});

describe("la hora del lugar", () => {
  test("Galápagos va una hora por detrás del Ecuador continental", () => {
    // Galápagos, UTC−6; quien mira, en Quito, UTC−5.
    expect(hoursAhead(-21_600, -300)).toBe(-1);
    expect(differenceText(-1)).toBe("1 h menos que tu hora");
    expect(differenceText(hoursAhead(3600, -300))).toBe("6 h más que tu hora");
    expect(differenceText(0)).toBeNull();
    // India va con media hora de desfase.
    expect(differenceText(hoursAhead(19_800, 0))).toBe("5 h 30 min más que tu hora");
    expect(differenceText(-0.5)).toBe("30 min menos que tu hora");
  });

  test("dice la hora de ahora allí y la del dato del modelo", () => {
    const now = Date.UTC(2026, 10, 15, 13, 41);
    expect(clockAt(now, -21_600)).toBe("07:41");
    expect(clockAt(now, 0)).toBe("13:41");
    expect(clockOf("2026-11-15T07:30")).toBe("07:30");
  });

  test("nombra la zona horaria en español y no falla con una desconocida", () => {
    const at = new Date(Date.UTC(2026, 10, 15));
    expect(zoneName("Pacific/Galapagos", at)).toBe("hora de Galápagos");
    expect(zoneName("America/Guayaquil", at)).toBe("hora de Ecuador");
    expect(zoneName("Zona/Que_No_Existe", at)).toBe("hora de Que No Existe");
    expect(zoneName("", at)).toBe("hora del lugar");
  });

  test("rotula los días de la semana con la fecha del lugar", () => {
    expect(dayLabel("2026-11-15")).toBe("domingo 15");
    expect(dayLabel("2026-11-16")).toBe("lunes 16");
    expect(dayLabel("2027-01-01")).toBe("viernes 1");
  });

  test("el clima de ahora guarda la zona, el desfase y el paso del modelo", () => {
    const weather = parseWeather({
      timezone: "Pacific/Galapagos",
      utc_offset_seconds: -21_600,
      elevation: 931,
      current: {
        time: "2026-11-15T07:30",
        interval: 900,
        temperature_2m: 21.3,
        relative_humidity_2m: 89,
        apparent_temperature: 24.2,
        is_day: 1,
        precipitation: 0,
        weather_code: 3,
        cloud_cover: 96,
        surface_pressure: 913,
        wind_speed_10m: 5,
        wind_direction_10m: 180,
      },
    });
    expect(weather).toMatchObject({ time: "2026-11-15T07:30", timezone: "Pacific/Galapagos", utcOffsetSeconds: -21_600, intervalSeconds: 900 });
    // Una respuesta sin esos campos sigue sirviendo.
    const plain = parseWeather({ current: { temperature_2m: 1, relative_humidity_2m: 1, apparent_temperature: 1, is_day: 0, precipitation: 0, weather_code: 0, cloud_cover: 0, surface_pressure: 1, wind_speed_10m: 1, wind_direction_10m: 1 } });
    expect(plain.utcOffsetSeconds).toBeUndefined();
    expect(plain.intervalSeconds).toBeUndefined();
  });
});

describe("la lluvia de estas fechas en años anteriores", () => {
  const now = Date.UTC(2026, 10, 15, 13, 0);

  test("pide las mismas fechas en los años del mismo modelo", () => {
    const windows = baselineWindows("2026-10-16", "2026-11-14");
    expect(windows).toHaveLength(BASELINE_YEARS);
    expect(windows[0]).toEqual({ year: BASELINE_FIRST_YEAR, start: "2017-10-16", end: "2017-11-14" });
    expect(windows.at(-1)).toEqual({ year: 2025, start: "2025-10-16", end: "2025-11-14" });
    // Un periodo que cruza el año nuevo no empieza antes de 2017, y se rotula con el año en que acaba.
    expect(baselineWindows("2026-12-20", "2027-01-18")[0]).toEqual({ year: 2018, start: "2017-12-20", end: "2018-01-18" });
    // Pronto habrá menos años comparables que los que se piden: no se inventan.
    expect(baselineWindows("2019-03-01", "2019-03-30").map((window) => window.year)).toEqual([2017, 2018]);
    // El 29 de febrero no existe en los años normales.
    expect(baselineWindows("2028-02-01", "2028-02-29").at(-1)).toEqual({ year: 2027, start: "2027-02-01", end: "2027-02-28" });
    expect(baselineWindows("2026-11-14", "2026-10-16")).toEqual([]);

    const url = new URL(baselineUrl(-0.83, -91.17, windows[0]));
    expect(url.origin + url.pathname).toBe(ARCHIVE_ENDPOINT);
    expect(url.searchParams.get("start_date")).toBe("2017-10-16");
    expect(url.searchParams.get("end_date")).toBe("2017-11-14");
    expect(url.searchParams.get("daily")).toBe("precipitation_sum");
  });

  test("suma cada año y deja fuera el que no trae días suficientes", () => {
    const window = { year: 2025, start: "2025-10-16", end: "2025-11-14" };
    expect(parseWindowTotal({ daily: { precipitation_sum: Array(30).fill(0.5) } }, window)).toBe(15);
    expect(parseWindowTotal({ daily: { precipitation_sum: [...Array(24).fill(1), ...Array(6).fill(null)] } }, window)).toBe(24);
    expect(parseWindowTotal({ daily: { precipitation_sum: [...Array(20).fill(1), ...Array(10).fill(null)] } }, window)).toBeNull();
    expect(parseWindowTotal({}, window)).toBeNull();
  });

  test("igual con igual: Sierra Negra se sale de lo habitual y el Etna no", () => {
    // Totales del 16 de octubre al 14 de noviembre de 2017 a 2025 en el archivo, leídos el 15 de noviembre de 2026.
    const years = (totals: number[]) => totals.map((totalMm, index) => ({ year: 2017 + index, totalMm }));
    const sierraNegra = summarize(years([1, 12, 20, 8, 31, 7, 63, 6, 9]));
    expect(sierraNegra).toMatchObject({ meanMm: 17.4, minMm: 1, maxMm: 63 });
    expect(compareRain(409, sierraNegra.meanMm)).toBe("mucho-mas");
    // El Etna: 146 mm este año, entre los 20 y los 631 de otros años.
    const etna = summarize(years([77, 221, 234, 36, 631, 20, 63, 249, 142]));
    expect(etna).toMatchObject({ meanMm: 185.9, minMm: 20, maxMm: 631 });
    expect(compareRain(146, etna.meanMm)).toBe("normal");
  });

  test("una consulta por año; tolera fallos sueltos, reutiliza la respuesta y no guarda un fallo total", async () => {
    const seen: string[] = [];
    const fetcher = (async (url: string) => {
      seen.push(url);
      const year = Number(new URL(url).searchParams.get("start_date")!.slice(0, 4));
      if (year === 2019) return new Response("{}", { status: 500 });
      return new Response(JSON.stringify({ daily: { precipitation_sum: Array(30).fill(year - 2016) } }));
    }) as unknown as typeof fetch;
    const baseline = await fetchRainBaseline(-0.83, -91.17, "2026-10-16", "2026-11-14", fetcher, now);
    expect(seen).toHaveLength(BASELINE_YEARS);
    expect(baseline.years.map((item) => item.year)).toEqual([2017, 2018, 2020, 2021, 2022, 2023, 2024, 2025]);
    expect(baseline).toMatchObject({ minMm: 30, maxMm: 270 });
    await fetchRainBaseline(-0.83, -91.17, "2026-10-16", "2026-11-14", fetcher, now);
    expect(seen).toHaveLength(BASELINE_YEARS);

    // Si casi todos los años fallan, no se dice qué es lo habitual; y el fallo no se guarda.
    await expect(fetchRainBaseline(2, 2, "2026-10-16", "2026-11-14", respond({}, 500), now)).rejects.toThrow();
    const again = await fetchRainBaseline(2, 2, "2026-10-16", "2026-11-14", respond({ daily: { precipitation_sum: Array(30).fill(1) } }), now);
    expect(again.meanMm).toBe(30);
    expect(again.years.length).toBeGreaterThanOrEqual(BASELINE_MIN_YEARS);
  });
});
