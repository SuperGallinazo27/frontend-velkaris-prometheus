import { describe, expect, test } from "bun:test";
import {
  EARTH_SOILS,
  gravimetricPercent,
  respondsToMoisture,
  soilById,
  soilForMoisture,
} from "../src/features/mission/wheelData";
import { DRIVE_VERDICTS, computeOutlooks, driveVerdict } from "../src/features/mission/wheelLab";
import {
  GROUND_RULES,
  GROUND_STATES,
  SOIL_STATE_SOURCES,
  familyOf,
  groundReading,
  textureOf,
  waterLimits,
  wheelSoil,
} from "../src/features/world/soilState";
import { groundResult } from "../src/features/world/useGroundNow";
import { FORECAST_DAYS, PAST_DAYS, fetchGroundForecast, groundForecastUrl, parseGroundForecast } from "../src/services/groundForecast";

const respond = (body: unknown, status = 200) =>
  (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

/** Las 14 jornadas que devuelve el servicio (7 pasadas y 7 por venir), hora a hora, en la hora del lugar. */
function hourly(options: { moisture?: (day: number, hour: number) => number | null; rain?: (day: number, hour: number) => number; soilTemp?: number; snow?: number } = {}) {
  const start = Date.UTC(2026, 10, 8); // 8 de noviembre, hora local del lugar escrita como UTC
  const time: string[] = [];
  const layer: (number | null)[] = [];
  const rain: number[] = [];
  for (let day = 0; day < PAST_DAYS + FORECAST_DAYS; day++) {
    for (let hour = 0; hour < 24; hour++) {
      time.push(new Date(start + (day * 24 + hour) * 3_600_000).toISOString().slice(0, 16));
      layer.push(options.moisture ? options.moisture(day, hour) : 0.2);
      rain.push(options.rain ? options.rain(day, hour) : 0);
    }
  }
  const constant = (value: number) => time.map(() => value);
  return {
    timezone: "Pacific/Galapagos",
    utc_offset_seconds: -21_600,
    hourly: {
      time,
      soil_moisture_0_to_1cm: layer,
      soil_moisture_1_to_3cm: layer,
      soil_moisture_3_to_9cm: layer,
      soil_temperature_0cm: constant(options.soilTemp ?? 18),
      snow_depth: constant(options.snow ?? 0),
      precipitation: rain,
      temperature_2m: time.map((_, i) => 15 + (i % 24)),
      wind_speed_10m: constant(12),
    },
  };
}

/** Las 13:00 UTC del 15 de noviembre: en Galápagos (UTC−6) son las 07:00 del día 15. */
const NOW = Date.UTC(2026, 10, 15, 13, 0);

describe("cuánta agua aguanta un suelo (Saxton y Rawls, 2006)", () => {
  test("un suelo franco da los valores de la tabla de los autores", () => {
    // 40 % de arena, 20 % de arcilla y 2,5 % de materia orgánica: marchitez 14 %, campo 28 %, saturación 46 %.
    const loam = waterLimits(null);
    expect(loam.generic).toBe(true);
    expect(loam.wilting).toBeCloseTo(0.137, 2);
    expect(loam.fieldCapacity).toBeCloseTo(0.28, 2);
    expect(loam.saturation).toBeCloseTo(0.46, 2);
  });

  test("la arena retiene menos agua que el suelo con arcilla", () => {
    const sandy = waterLimits(textureOf("pampa-de-la-joya"));
    const loamy = waterLimits(textureOf("sierra-negra"));
    expect(sandy.generic).toBe(false);
    expect(sandy.fieldCapacity).toBeCloseTo(0.162, 2);
    expect(loamy.fieldCapacity).toBeCloseTo(0.279, 2);
    expect(loamy.saturation).toBeCloseTo(0.441, 2);
    expect(sandy.fieldCapacity).toBeLessThan(loamy.fieldCapacity);
    for (const limits of [sandy, loamy]) {
      expect(limits.wilting).toBeLessThan(limits.fieldCapacity);
      expect(limits.fieldCapacity).toBeLessThan(limits.saturation);
    }
  });

  test("las fuentes están citadas con su dirección", () => {
    for (const source of Object.values(SOIL_STATE_SOURCES)) expect(source.url).toStartWith("https://");
    expect(SOIL_STATE_SOURCES.pedotransfer.url).toBe("https://doi.org/10.2136/sssaj2005.0117");
  });
});

describe("estado del suelo", () => {
  const limits = waterLimits(textureOf("sierra-negra"));
  const dry = { rain3dMm: 0, soilTemp: 18, snowDepth: 0 };

  test("la humedad decide entre seco, húmedo y embarrado", () => {
    expect(groundReading({ ...dry, moisture: 0.05 }, limits, 54).state).toBe("seco");
    const moist = groundReading({ ...dry, moisture: 0.24 }, limits, 54);
    expect(moist.state).toBe("humedo");
    // Sierra Negra en noviembre de 2026: 0,40 a 0,44 m³/m³, casi saturado.
    const mud = groundReading({ ...dry, moisture: 0.42 }, limits, 54);
    expect(mud.state).toBe("embarrado");
    expect(mud.saturationShare).toBeGreaterThan(0.9);
    expect(mud.reason).toContain("más agua de la que puede retener");
    // Justo en la capacidad de campo ya cuenta como embarrado.
    expect(groundReading({ ...dry, moisture: limits.fieldCapacity }, limits, 54).state).toBe("embarrado");
  });

  test("sin agua reciente no hay barro, diga lo que diga la humedad del modelo", () => {
    // El Etna, 15 de noviembre de 2026: 0,285 m³/m³ con 1 mm de lluvia en siete días.
    const generic = waterLimits(null);
    const drained = groundReading({ ...dry, moisture: 0.285, rain7dMm: 1 }, generic, null);
    expect(drained.state).toBe("humedo");
    expect(drained.reason).toContain("ya ha drenado");
    expect(drained.reason).toContain("1 mm");
    // Con agua reciente, la misma humedad sí es barro.
    expect(groundReading({ ...dry, moisture: 0.285, rain7dMm: GROUND_RULES.mudNeedsRainMm }, generic, null).state).toBe("embarrado");
    // La regla no convierte en húmedo un suelo que el modelo da por seco.
    expect(groundReading({ ...dry, moisture: 0.05, rain7dMm: 0 }, generic, null).state).toBe("seco");
  });

  test("la lluvia reciente moja la superficie aunque el modelo dé el suelo por seco", () => {
    expect(groundReading({ ...dry, moisture: 0.05, rain3dMm: GROUND_RULES.rainWetsMm - 1 }, limits, 54).state).toBe("seco");
    expect(groundReading({ ...dry, moisture: 0.05, rain3dMm: 12 }, limits, 54).state).toBe("humedo");
    const soaked = groundReading({ ...dry, moisture: 0.05, rain3dMm: 86 }, limits, 54);
    expect(soaked.state).toBe("embarrado");
    expect(soaked.reason).toContain("86 mm");
  });

  test("la arena drena: mojada no se embarra", () => {
    const sand = waterLimits(textureOf("desierto-del-namib"));
    expect(groundReading({ ...dry, moisture: 0.3 }, sand, 81.7).state).toBe("humedo");
    expect(groundReading({ ...dry, moisture: 0.03, rain3dMm: 80 }, sand, 81.7).state).toBe("humedo");
  });

  test("la nieve y el hielo se dicen aparte", () => {
    expect(groundReading({ moisture: 0.3, rain3dMm: 0, soilTemp: -4, snowDepth: 0.15 }, limits, 54).state).toBe("nevado");
    expect(groundReading({ moisture: 0.3, rain3dMm: 0, soilTemp: -4, snowDepth: 0 }, limits, 54).state).toBe("helado");
    // Un suelo seco y frío sigue siendo un suelo seco: no hay agua que se congele.
    expect(groundReading({ moisture: 0.03, rain3dMm: 0, soilTemp: -20, snowDepth: 0 }, limits, 54).state).toBe("seco");
  });

  test("sin dato de humedad solo se mira la lluvia, y se dice", () => {
    const blind = groundReading({ ...dry, moisture: null }, limits, 54);
    expect(blind.state).toBe("seco");
    expect(blind.saturationShare).toBeNull();
    expect(blind.reason).toContain("no da la humedad");
    expect(groundReading({ ...dry, moisture: null, rain3dMm: 60 }, limits, 54).state).toBe("embarrado");
  });

  test("cada estado tiene nombre, símbolo y explicación", () => {
    for (const state of Object.values(GROUND_STATES)) {
      expect(state.name.length).toBeGreaterThan(2);
      expect(state.symbol).toHaveLength(1);
      expect(state.detail.length).toBeGreaterThan(10);
    }
  });
});

describe("suelos húmedos del cálculo de ruedas (NASA TM-20250006958, tabla 1)", () => {
  test("las filas están copiadas de la tabla y pasadas al SI", () => {
    // n, kc (kN/m^(n+1)), kφ (kN/m^(n+2)), c (kPa) y φ (°) de la tabla; aquí en N y Pa.
    expect(soilById("franco-arenoso").soil).toMatchObject({ n: 0.7, kc: 5270, kphi: 1_515_040, cohesion: 1720, frictionDeg: 29 });
    expect(soilById("franco-arenoso-22").soil).toMatchObject({ n: 0.2, kc: 2560, kphi: 43_120, cohesion: 1380, frictionDeg: 38 });
    expect(soilById("franco-arenoso-26").soil).toMatchObject({ n: 0.3, kc: 2790, kphi: 141_110, cohesion: 13_790, frictionDeg: 22 });
    expect(soilById("franco-arenoso-32").soil).toMatchObject({ n: 0.5, kc: 770, kphi: 51_910, cohesion: 5170, frictionDeg: 11 });
    expect(soilById("arcilloso").soil).toMatchObject({ n: 0.5, kc: 13_190, kphi: 692_150, cohesion: 4140, frictionDeg: 13 });
    expect(soilById("arcilloso-55").soil).toMatchObject({ n: 0.7, kc: 16_030, kphi: 1_262_530, cohesion: 2070, frictionDeg: 10 });
  });

  test("cada fila dice su humedad y su clase, y las húmedas avisan de que no se midieron aquí", () => {
    expect(EARTH_SOILS.filter((soil) => soil.family === "franco-arenoso").map((soil) => soil.moisturePercent)).toEqual([15, 22, 26, 32]);
    expect(EARTH_SOILS.filter((soil) => soil.family === "arcilloso").map((soil) => soil.moisturePercent)).toEqual([38, 55]);
    for (const id of ["franco-arenoso-22", "franco-arenoso-26", "franco-arenoso-32", "arcilloso-55"] as const) {
      const soil = soilById(id);
      expect(soil.name).toContain(`${soil.moisturePercent} % de humedad`);
      expect(soil.assumed.join(" ")).toContain("no se midieron en este lugar");
      expect(soil.sources[0].url).toContain("20250006958");
    }
    expect(respondsToMoisture("franco-arenoso")).toBe(true);
    expect(respondsToMoisture("arcilloso")).toBe(true);
    // La tabla no trae arena húmeda: la humedad no cambia el cálculo en la arena.
    expect(respondsToMoisture("arena")).toBe(false);
    expect(respondsToMoisture("simulante")).toBe(false);
  });

  test("la humedad en volumen se pasa a peso con la densidad del suelo y elige la fila más cercana", () => {
    // 0,42 m³/m³ en un suelo de 1,3 g/cm³ son 32 g de agua por cada 100 g de suelo seco.
    expect(gravimetricPercent(0.42, 1.3)).toBeCloseTo(32.3, 1);
    expect(soilForMoisture("franco-arenoso", 4).id).toBe("franco-arenoso");
    expect(soilForMoisture("franco-arenoso", 20).id).toBe("franco-arenoso-22");
    expect(soilForMoisture("franco-arenoso", 25).id).toBe("franco-arenoso-26");
    expect(soilForMoisture("franco-arenoso", 31).id).toBe("franco-arenoso-32");
    expect(soilForMoisture("franco-arenoso", 80).id).toBe("franco-arenoso-32");
    expect(soilForMoisture("arcilloso", 40).id).toBe("arcilloso");
    expect(soilForMoisture("arcilloso", 60).id).toBe("arcilloso-55");
    expect(soilForMoisture("arena", 30).id).toBe("arena-seca");
  });

  test("el estado manda: el barro va a la fila más húmeda y lo demás nunca llega a ella", () => {
    // Embarrado: la fila más húmeda de su clase, aunque la humedad en peso quede lejos de ella.
    expect(wheelSoil("franco-arenoso", "embarrado", 0.2, 1.36).preset.id).toBe("franco-arenoso-32");
    expect(wheelSoil("franco-arenoso", "embarrado", null, 1.3).preset.id).toBe("franco-arenoso-32");
    expect(wheelSoil("arcilloso", "embarrado", 0.45, 1.2).preset.id).toBe("arcilloso-55");
    // Seco o húmedo: la más parecida de las demás. Un suelo ligero (0,7 g/cm³) con mucha agua en peso no es barro.
    expect(wheelSoil("franco-arenoso", "humedo", 0.25, 0.7).preset.id).toBe("franco-arenoso-26");
    expect(wheelSoil("franco-arenoso", "seco", 0.1, 1.3).preset.id).toBe("franco-arenoso");
    expect(wheelSoil("franco-arenoso", "humedo", 0.26, 1.3).preset.id).toBe("franco-arenoso-22");
    expect(wheelSoil("arcilloso", "humedo", 0.6, 1.0).preset.id).toBe("arcilloso");
  });

  test("la nieve usa la fila de nieve y el suelo helado, la más seca de su clase", () => {
    expect(wheelSoil("franco-arenoso", "nevado", 0.4, 1.3).preset.id).toBe("nieve");
    expect(wheelSoil("franco-arenoso", "helado", 0.4, 1.3).preset.id).toBe("franco-arenoso");
    expect(wheelSoil("franco-arenoso", "embarrado", 0.42, 1.3)).toMatchObject({ responds: true });
    expect(wheelSoil("franco-arenoso", "embarrado", 0.42, 1.3).preset.id).toBe("franco-arenoso-32");
    // Sin densidad del lugar se supone la de un suelo mineral común y, sin humedad, la fila más seca.
    expect(wheelSoil("franco-arenoso", "humedo", 0.3, null).preset.id).toBe("franco-arenoso-22");
    expect(wheelSoil("franco-arenoso", "seco", null, 1.3)).toMatchObject({ moisturePercent: null });
    expect(wheelSoil("arena", "humedo", 0.3, 1.4)).toMatchObject({ responds: false });
    expect(wheelSoil("arena", "humedo", 0.3, 1.4).preset.id).toBe("arena-seca");
  });

  test("la clase de cada lugar sale de su textura", () => {
    expect(familyOf("sierra-negra")).toBe("franco-arenoso");
    expect(familyOf("pampa-de-la-joya")).toBe("arena");
    // Sin textura en el mapa: arena, como en la pestaña «Ruedas».
    expect(familyOf("monte-etna")).toBe("arena");
  });
});

describe("consulta de la humedad del suelo", () => {
  test("pide las tres capas, la lluvia, la nieve y el tiempo, 7 días atrás y 7 adelante", () => {
    const url = new URL(groundForecastUrl(-0.83, -91.17));
    expect(url.origin + url.pathname).toBe("https://api.open-meteo.com/v1/forecast");
    const wanted = url.searchParams.get("hourly")!.split(",");
    for (const name of ["soil_moisture_0_to_1cm", "soil_moisture_1_to_3cm", "soil_moisture_3_to_9cm", "soil_temperature_0cm", "snow_depth", "precipitation"]) {
      expect(wanted).toContain(name);
    }
    expect(url.searchParams.get("past_days")).toBe(String(PAST_DAYS));
    expect(url.searchParams.get("forecast_days")).toBe(String(FORECAST_DAYS));
    expect(url.searchParams.get("timezone")).toBe("auto");
  });

  test("encuentra la hora de ahora en la hora del lugar y suma la lluvia anterior", () => {
    // Un milímetro por hora durante todo el periodo.
    const forecast = parseGroundForecast(hourly({ rain: () => 1 }), NOW);
    expect(forecast.timezone).toBe("Pacific/Galapagos");
    expect(forecast.utcOffsetSeconds).toBe(-21_600);
    expect(forecast.now.time).toBe("2026-11-15T07:00");
    expect(forecast.rain72hMm).toBe(72);
    expect(forecast.rain7dMm).toBe(168);
  });

  test("da hoy y los seis días siguientes, con la media del día", () => {
    const forecast = parseGroundForecast(
      hourly({ moisture: (day) => (day < 9 ? 0.4 : 0.1), rain: (day, hour) => (day === 7 && hour < 5 ? 2 : 0) }),
      NOW,
    );
    expect(forecast.days.map((day) => day.date)).toEqual([
      "2026-11-15", "2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20", "2026-11-21",
    ]);
    expect(forecast.days[0]).toMatchObject({ moisture: 0.4, rainMm: 10, rain3dMm: 10, rain7dMm: 10, temperatureMin: 15, temperatureMax: 38, windMean: 12 });
    expect(forecast.days[1]).toMatchObject({ moisture: 0.4, rainMm: 0, rain3dMm: 10 });
    expect(forecast.days[2]).toMatchObject({ moisture: 0.1, rain3dMm: 10 });
    // La lluvia de tres días ya no la cuenta; la de siete, sí.
    expect(forecast.days[3]).toMatchObject({ rain3dMm: 0, rain7dMm: 10 });
    expect(forecast.days[6]).toMatchObject({ rain3dMm: 0, rain7dMm: 10 });
  });

  test("pesa cada capa por su espesor y tolera capas sin dato", () => {
    const body = hourly();
    body.hourly.soil_moisture_0_to_1cm = body.hourly.time.map(() => 0.9);
    body.hourly.soil_moisture_1_to_3cm = body.hourly.time.map(() => 0.45);
    body.hourly.soil_moisture_3_to_9cm = body.hourly.time.map(() => 0.15);
    // (0,9 × 1 + 0,45 × 2 + 0,15 × 6) / 9 = 0,3
    expect(parseGroundForecast(body, NOW).now.moisture).toBeCloseTo(0.3, 3);
    body.hourly.soil_moisture_3_to_9cm = body.hourly.time.map(() => null);
    expect(parseGroundForecast(body, NOW).now.moisture).toBeCloseTo(0.6, 3);
    const empty = hourly({ moisture: () => null });
    expect(parseGroundForecast(empty, NOW).now.moisture).toBeNull();
    expect(parseGroundForecast(empty, NOW).days[0].moisture).toBeNull();
  });

  test("rechaza respuestas vacías y no guarda los fallos", async () => {
    expect(() => parseGroundForecast({}, NOW)).toThrow();
    expect(() => parseGroundForecast({ hourly: { time: ["2026-11-15T00:00"] } }, NOW)).toThrow();
    await expect(fetchGroundForecast(1, 1, respond({}, 500), NOW)).rejects.toThrow("500");
    const forecast = await fetchGroundForecast(1, 1, respond(hourly()), NOW);
    expect(forecast.days).toHaveLength(FORECAST_DAYS);
  });
});

describe("el suelo de hoy, listo para usar", () => {
  test("Sierra Negra saturada: embarrado, con la fila de 32 % de humedad", () => {
    const result = groundResult(parseGroundForecast(hourly({ moisture: () => 0.42, rain: () => 1.2 }), NOW), "sierra-negra");
    expect(result.summary).toMatchObject({
      state: "embarrado",
      stateName: "Embarrado",
      wet: true,
      moisture: 0.42,
      soilId: "franco-arenoso-32",
      soilName: "Franco arenoso, 32 % de humedad",
    });
    expect(result.summary.saturationPercent).toBeGreaterThan(90);
    expect(result.summary.rain72hMm).toBeCloseTo(86.4, 1);
    expect(result.days).toHaveLength(FORECAST_DAYS);
    expect(result.days.every((day) => day.reading.state === "embarrado" && day.soil.preset.id === "franco-arenoso-32")).toBe(true);
    expect(result.limits.generic).toBe(false);
  });

  test("Pampa de La Joya seca: firme toda la semana, con arena seca", () => {
    const result = groundResult(parseGroundForecast(hourly({ moisture: () => 0.04 }), NOW), "pampa-de-la-joya");
    expect(result.summary).toMatchObject({ state: "seco", wet: false, soilId: "arena-seca" });
    expect(result.soil.responds).toBe(false);
  });

  test("un lugar sin textura usa los límites de un suelo franco y lo dice", () => {
    const result = groundResult(parseGroundForecast(hourly({ moisture: () => 0.2 }), NOW), "paramo-del-cotopaxi");
    expect(result.limits.generic).toBe(true);
    expect(result.summary.state).toBe("seco");
  });

  test("con otra clase de suelo, el estado de cada día elige su fila", () => {
    // Llueve hasta mañana y luego se seca: de embarrado a húmedo y a firme.
    const drying = hourly({
      moisture: (day) => (day < 9 ? 0.42 : day < 11 ? 0.3 : day < 12 ? 0.25 : 0.12),
      rain: (day) => (day >= 6 && day < 9 ? 1 : 0),
    });
    const result = groundResult(parseGroundForecast(drying, NOW), "paramo-del-cotopaxi", "franco-arenoso");
    expect(result.days.map((day) => day.reading.state)).toEqual(["embarrado", "embarrado", "embarrado", "embarrado", "humedo", "seco", "seco"]);
    expect(result.days.map((day) => day.soil.preset.id)).toEqual([
      "franco-arenoso-32", "franco-arenoso-32", "franco-arenoso-32", "franco-arenoso-32",
      "franco-arenoso-22", "franco-arenoso", "franco-arenoso",
    ]);
  });

  test("una semana sin lluvia no da barro aunque el modelo dé el suelo cargado de agua", () => {
    const result = groundResult(parseGroundForecast(hourly({ moisture: () => 0.3 }), NOW), "monte-etna");
    expect(result.summary.state).toBe("humedo");
    expect(result.days.every((day) => day.reading.state === "humedo")).toBe(true);
  });
});

describe("pronóstico de rodadura", () => {
  test("calcula cada suelo una sola vez y da su veredicto en la pendiente típica", () => {
    const outlooks = computeOutlooks("viper", ["franco-arenoso", "franco-arenoso-32", "franco-arenoso", "franco-arenoso-22"], 6.5);
    expect(outlooks.map((item) => item.soil)).toEqual(["franco-arenoso", "franco-arenoso-32", "franco-arenoso-22"]);
    const by = Object.fromEntries(outlooks.map((item) => [item.soil, item]));
    // Con 15 % de humedad VIPER sube 6,5° dentro del límite; embarrado (32 %) no avanza ni en llano.
    expect(driveVerdict(by["franco-arenoso"])).toBe("bien");
    expect(by["franco-arenoso"].maxSlope).toBeGreaterThan(8);
    expect(driveVerdict(by["franco-arenoso-32"])).toBe("atasca");
    expect(by["franco-arenoso-32"].flat.outcome).not.toBe("avanza");
    expect(by["franco-arenoso-32"].maxSlope).toBe(0);
    // Húmedo sin llegar a barro agarra mejor que seco: sube más.
    expect(by["franco-arenoso-22"].maxSlope).toBeGreaterThan(by["franco-arenoso"].maxSlope);
  });

  test("patinar más del límite o hundirse demasiado es «con cuidado»", () => {
    const [steep] = computeOutlooks("viper", ["franco-arenoso"], 10);
    expect(steep.typical.outcome).toBe("avanza");
    expect(steep.typical.slip!).toBeGreaterThan(0.4);
    expect(driveVerdict(steep)).toBe("cuidado");
    expect(Object.keys(DRIVE_VERDICTS)).toEqual(["bien", "cuidado", "atasca"]);
  });
});
