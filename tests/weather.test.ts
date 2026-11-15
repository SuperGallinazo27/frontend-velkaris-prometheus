import { describe, expect, test } from "bun:test";
import { compassOf, describeWeatherCode, fetchCurrentWeather, parseWeather, weatherUrl } from "../src/services/weather";

const sample = {
  timezone: "America/Santiago",
  elevation: 2611,
  current: {
    time: "2026-11-14T17:15",
    interval: 900,
    temperature_2m: 27.5,
    relative_humidity_2m: 5,
    apparent_temperature: 19.9,
    is_day: 1,
    precipitation: 0,
    weather_code: 0,
    cloud_cover: 16,
    surface_pressure: 755,
    wind_speed_10m: 31,
    wind_direction_10m: 277,
  },
};

const respond = (body: unknown, status = 200) =>
  (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe("clima actual", () => {
  test("arma la consulta con coordenadas y zona horaria automática", () => {
    const url = new URL(weatherUrl(-22.92, -68.28));
    expect(url.origin + url.pathname).toBe("https://api.open-meteo.com/v1/forecast");
    expect(url.searchParams.get("latitude")).toBe("-22.9200");
    expect(url.searchParams.get("timezone")).toBe("auto");
    expect(url.searchParams.get("current")).toContain("weather_code");
  });

  test("convierte la respuesta", () => {
    const weather = parseWeather(sample);
    expect(weather.temperature).toBe(27.5);
    expect(weather.description).toBe("Despejado");
    expect(weather.isDay).toBe(true);
    expect(weather.timezone).toBe("America/Santiago");
  });

  test("rechaza respuestas incompletas", () => {
    expect(() => parseWeather({ current: { ...sample.current, temperature_2m: null } })).toThrow();
    expect(() => parseWeather({})).toThrow();
  });

  test("describe códigos WMO y puntos cardinales", () => {
    expect(describeWeatherCode(95)).toBe("Tormenta");
    expect(describeWeatherCode(42)).toBe("Estado desconocido");
    expect(compassOf(277)).toBe("O");
    expect(compassOf(0)).toBe("N");
    expect(compassOf(359)).toBe("N");
    expect(compassOf(-45)).toBe("NO");
  });

  test("reutiliza la consulta y no guarda los fallos", async () => {
    let calls = 0;
    const counting = (async () => {
      calls += 1;
      return new Response(JSON.stringify(sample));
    }) as unknown as typeof fetch;
    await fetchCurrentWeather(1.5, 2.5, counting, 1000);
    await fetchCurrentWeather(1.5, 2.5, counting, 2000);
    expect(calls).toBe(1);

    await expect(fetchCurrentWeather(3.5, 4.5, respond({}, 500), 1000)).rejects.toThrow("500");
    const weather = await fetchCurrentWeather(3.5, 4.5, respond(sample), 1000);
    expect(weather.code).toBe(0);
  });
});
