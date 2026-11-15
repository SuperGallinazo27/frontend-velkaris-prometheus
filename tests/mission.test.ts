import { describe, expect, test } from "bun:test";
import { PLAN_NOTES, WINDOW_STATUS, missionCode, planText, quarters } from "../src/features/mission/campaign";
import type { MissionPlan } from "../src/features/mission/campaign";
import { CITIES, DEFAULT_ASSUMPTIONS, estimateCampaign, haversineKm } from "../src/features/mission/cost";
import {
  MOON_GRAVITY,
  bilinear,
  decodeTerrarium,
  fileSlug,
  latToTile,
  lonToTile,
  offsetToLatLon,
  sampleGrid,
  terrainStats,
  tilesFor,
  toObj,
  toPackage,
  zoomFor,
} from "../src/features/mission/twin";
import type { TerrainGrid } from "../src/features/mission/twin";
import type { MonthProfile, Rating } from "../src/features/world/climate";

const site = { name: "Monte Etna", latitude: 37.75, longitude: 14.99 };

/** Malla plana inclinada: sube `rise` metros por celda hacia el este. */
function ramp(cells: number, sizeM: number, rise: number, base = 1000): TerrainGrid {
  const points = cells + 1;
  const heights = new Float32Array(points * points);
  for (let row = 0; row < points; row++) for (let col = 0; col < points; col++) heights[row * points + col] = base + col * rise;
  return { cells, sizeM, heights, zoom: 12, sourcePixelM: 30 };
}

describe("gemelo digital: elevación", () => {
  test("decodifica las alturas Terrarium", () => {
    expect(decodeTerrarium(128, 0, 0)).toBe(0);
    expect(decodeTerrarium(134, 136, 0)).toBe(1672);
    expect(decodeTerrarium(127, 255, 128)).toBeCloseTo(-0.5, 6);
  });

  test("ubica un punto en la cuadrícula de teselas", () => {
    expect(lonToTile(-180, 3)).toBe(0);
    expect(lonToTile(0, 3)).toBe(4);
    expect(latToTile(0, 3)).toBeCloseTo(4, 9);
    // El Etna cae en la tesela 11/1109/791 de la cuadrícula web estándar.
    expect(Math.floor(lonToTile(14.99, 11))).toBe(1109);
    expect(Math.floor(latToTile(37.75, 11))).toBe(791);
    // En esta proyección el mundo termina cerca de los 85,05° de latitud.
    expect(latToTile(85.0511, 3)).toBeCloseTo(0, 3);
    expect(latToTile(-85.0511, 3)).toBeCloseTo(8, 3);
  });

  test("elige un zoom con píxeles al menos tan finos como la celda", () => {
    const pixel = (latitude: number, zoom: number) => (40_075_016.686 * Math.cos((latitude * Math.PI) / 180)) / (256 * 2 ** zoom);
    for (const latitude of [0, 37.75, -77.5]) {
      for (const cell of [281, 141, 70]) {
        const zoom = zoomFor(latitude, cell);
        expect(pixel(latitude, zoom)).toBeLessThanOrEqual(cell);
        expect(pixel(latitude, zoom - 1)).toBeGreaterThan(cell);
      }
    }
    expect(zoomFor(0, 0.01)).toBe(14);
  });

  test("el área pide pocas teselas, también cerca de los polos", () => {
    for (const latitude of [0, 37.75, 65, -77.5, 79.4]) {
      const zoom = zoomFor(latitude, 18000 / 256);
      const { x0, x1, y0, y1 } = tilesFor(latitude, 10, 18000, zoom);
      expect((x1 - x0 + 1) * (y1 - y0 + 1)).toBeLessThanOrEqual(16);
    }
  });

  test("un desplazamiento en metros se convierte en grados", () => {
    const north = offsetToLatLon(0, 0, 0, 111_320);
    expect(north.latitude).toBeCloseTo(1, 6);
    const east = offsetToLatLon(60, 0, 111_320, 0);
    expect(east.longitude).toBeCloseTo(2, 6);
  });

  test("interpola entre píxeles vecinos", () => {
    const read = (px: number, py: number) => px * 10 + py;
    expect(bilinear(read, 3.5, 2.5)).toBeCloseTo(32, 9);
    expect(bilinear(read, 4, 2.5)).toBeCloseTo(37, 9);
    expect(bilinear(read, 3.5, 3)).toBeCloseTo(32.5, 9);
  });

  test("muestrea la malla de sur a norte y de oeste a este", () => {
    const zoom = 10;
    // Terreno ficticio: la altura crece hacia el este y hacia el norte.
    const read = (px: number, py: number) => px - py;
    const heights = sampleGrid(read, 10, 20, 18000, 4, zoom);
    expect(heights).toHaveLength(25);
    expect(heights[1]).toBeGreaterThan(heights[0]);
    expect(heights[5]).toBeGreaterThan(heights[0]);
    expect(heights[24]).toBeGreaterThan(heights[12]);
  });
});

describe("gemelo digital: archivos", () => {
  test("mide relieve y pendiente de la malla", () => {
    // 100 m por celda de 1000 m: una rampa de 5,71°.
    const stats = terrainStats(ramp(8, 8000, 100));
    expect(stats.minM).toBe(1000);
    expect(stats.maxM).toBe(1800);
    expect(stats.reliefM).toBe(800);
    expect(stats.slopeMeanDeg).toBeCloseTo(5.71, 2);
    expect(stats.slopeMaxDeg).toBeCloseTo(5.71, 2);
  });

  test("el OBJ lleva todos los vértices y dos triángulos por celda, en metros reales", () => {
    const obj = toObj(ramp(4, 4000, 50), site, "2026-11-14T00:00:00Z");
    const lines = obj.trim().split("\n");
    const vertices = lines.filter((line) => line.startsWith("v "));
    const faces = lines.filter((line) => line.startsWith("f "));
    expect(vertices).toHaveLength(25);
    expect(faces).toHaveLength(32);
    // Esquina suroeste en el origen de alturas; esquina noreste, 200 m más arriba.
    expect(vertices[0]).toBe("v -2000.00 -2000.00 0.00");
    expect(vertices[24]).toBe("v 2000.00 2000.00 200.00");
    expect(faces[0]).toBe("f 1 2 7");
    expect(faces[1]).toBe("f 1 7 6");
    // Ningún índice se sale de la malla.
    const indices = faces.flatMap((line) => line.split(" ").slice(1).map(Number));
    expect(Math.min(...indices)).toBe(1);
    expect(Math.max(...indices)).toBe(25);
    expect(obj).toContain("# Lugar: Monte Etna (37.7500, 14.9900)");
    expect(obj).toContain("Z = 0 corresponde a 1000.0 m");
  });

  test("las caras miran hacia arriba", () => {
    const obj = toObj(ramp(1, 100, 0), site, "x");
    const points = obj.split("\n").filter((l) => l.startsWith("v ")).map((l) => l.split(" ").slice(1).map(Number));
    const [a, b, c] = obj.split("\n").find((l) => l.startsWith("f "))!.split(" ").slice(1).map((i) => points[Number(i) - 1]);
    const normalZ = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    expect(normalZ).toBeGreaterThan(0);
  });

  test("el paquete de simulación trae alturas, pendientes y gravedad lunar, sin física inventada", () => {
    const reference = { name: "Haworth", relief: 583, slope: 9.8, roughness: 34.8 };
    const pack = toPackage(ramp(4, 4000, 50), site, reference, "2026-11-14T00:00:00Z");
    expect(pack.heightmap.rows).toBe(5);
    expect(pack.heightmap.heights_m).toHaveLength(25);
    expect(pack.heightmap.heights_m[0]).toBe(1000);
    expect(pack.area).toEqual({ size_m: 4000, cells: 4, cell_m: 1000 });
    expect(pack.elevation.relief_m).toBe(200);
    expect(pack.gravity.moon_m_s2).toBe(MOON_GRAVITY);
    expect(pack.physics.friction_coefficient).toBeNull();
    expect(pack.physics.cohesion_kpa).toBeNull();
    expect(pack.lunar_reference?.region).toBe("Haworth");
    expect(toPackage(ramp(2, 100, 0), site, null, "x").lunar_reference).toBeNull();
    expect(() => JSON.stringify(pack)).not.toThrow();
  });

  test("los nombres de archivo no llevan acentos ni espacios", () => {
    expect(fileSlug("Páramo del Cotopaxi")).toBe("paramo-del-cotopaxi");
    expect(fileSlug("  Cráter Haughton (Nunavut) ")).toBe("crater-haughton-nunavut");
  });
});

describe("costo de la campaña", () => {
  test("la distancia es la del círculo máximo", () => {
    const quito = CITIES.find((c) => c.name === "Quito")!;
    const madrid = CITIES.find((c) => c.name === "Madrid")!;
    expect(haversineKm(quito, quito)).toBe(0);
    // Quito–Madrid: unos 8750 km.
    expect(haversineKm(quito, madrid)).toBeGreaterThan(8600);
    expect(haversineKm(quito, madrid)).toBeLessThan(8900);
    expect(haversineKm(quito, madrid)).toBeCloseTo(haversineKm(madrid, quito), 6);
    // Medio mundo, por el ecuador.
    expect(haversineKm({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 180 })).toBeCloseTo(Math.PI * 6371, 3);
  });

  test("suma pasajes, carga, campo, permisos e imprevistos", () => {
    const cost = estimateCampaign({ distanceKm: 1000, people: 4, cargoKg: 100, days: 10, seasonFactor: 1 });
    expect(cost.flights).toBeCloseTo(4 * 2 * (150 + 0.11 * 1000), 6);
    expect(cost.cargo).toBeCloseTo(100 * 2 * (2 + 0.0006 * 1000), 6);
    expect(cost.field).toBeCloseTo(4 * 10 * 120 + 10 * 450, 6);
    expect(cost.permits).toBe(2500);
    const subtotal = cost.flights + cost.cargo + cost.field + cost.permits;
    expect(cost.contingency).toBeCloseTo(subtotal * 0.15, 6);
    expect(cost.total).toBeCloseTo(subtotal * 1.15, 6);
    expect(cost.perDay).toBeCloseTo(cost.total / 10, 6);
  });

  test("más lejos, más gente o peor temporada nunca abaratan", () => {
    const base = { distanceKm: 3000, people: 5, cargoKg: 200, days: 14, seasonFactor: 1 };
    const total = (changes: Partial<typeof base>) => estimateCampaign({ ...base, ...changes }).total;
    expect(total({ distanceKm: 6000 })).toBeGreaterThan(total({}));
    expect(total({ people: 6 })).toBeGreaterThan(total({}));
    expect(total({ cargoKg: 400 })).toBeGreaterThan(total({}));
    expect(total({ seasonFactor: 1.6 })).toBeGreaterThan(total({}));
    // La temporada solo encarece el trabajo de campo.
    const hard = estimateCampaign({ ...base, seasonFactor: 1.6 });
    expect(hard.flights).toBe(estimateCampaign(base).flights);
    expect(hard.field).toBeCloseTo(estimateCampaign(base).field * 1.6, 6);
  });

  test("valores fuera de rango se acotan en vez de dar un total absurdo", () => {
    const cost = estimateCampaign({ distanceKm: -5, people: 99, cargoKg: -3, days: 0, seasonFactor: 0.2 });
    expect(cost.cargo).toBe(0);
    expect(cost.flights).toBe(15 * 2 * DEFAULT_ASSUMPTIONS.flightBase);
    expect(cost.field).toBe(15 * 1 * 120 + 450);
    expect(Number.isFinite(estimateCampaign({ distanceKm: Number.NaN, people: Number.NaN, cargoKg: Number.NaN, days: Number.NaN, seasonFactor: Number.NaN }).total)).toBe(true);
  });

  test("las tarifas se pueden cambiar", () => {
    const free = estimateCampaign(
      { distanceKm: 1000, people: 2, cargoKg: 50, days: 5, seasonFactor: 1 },
      { ...DEFAULT_ASSUMPTIONS, permits: 0, contingency: 0, perDiem: 0, localSupportPerDay: 0 },
    );
    expect(free.field).toBe(0);
    expect(free.total).toBeCloseTo(free.flights + free.cargo, 6);
  });
});

describe("ventanas de campaña", () => {
  const month = (index: number, rating: Rating, reasons: string[] = []): MonthProfile => ({
    index,
    temperature: 10 + index,
    temperatureMin: 5 + index,
    temperatureMax: 15 + index,
    precipitation: 10,
    wind: 10,
    cloud: 20,
    daylight: 12,
    rating,
    reasons,
  });

  test("cada trimestre resume sus tres meses", () => {
    const year = [
      month(0, "dificil", ["frío extremo"]),
      month(1, "dificil", ["frío extremo", "nieve"]),
      month(2, "aceptable", ["frío"]),
      month(3, "aceptable", ["lluvia"]),
      month(4, "favorable"),
      month(5, "favorable"),
      month(6, "favorable"),
      month(7, "favorable"),
      month(8, "favorable"),
      month(9, "aceptable", ["lluvia"]),
      month(10, "aceptable", ["lluvia"]),
      month(11, "dificil", ["mucha lluvia"]),
    ];
    const [q1, q2, q3, q4] = quarters(year);
    expect([q1.name, q2.name, q3.name, q4.name]).toEqual(["Ene–Mar", "Abr–Jun", "Jul–Sep", "Oct–Dic"]);
    expect([q1.status, q2.status, q3.status, q4.status]).toEqual(["restringida", "optima", "optima", "exigente"]);
    expect(q1.reasons).toEqual(["frío extremo", "nieve", "frío"]);
    expect(q3.reasons).toEqual([]);
    expect(q1.precipitation).toBe(30);
    expect(q1.temperatureMin).toBe(5);
    expect(q1.temperatureMax).toBe(17);
    expect(WINDOW_STATUS[q1.status].factor).toBeGreaterThan(WINDOW_STATUS[q2.status].factor);
  });

  test("el código identifica el plan y es distinto cada vez", () => {
    expect(missionCode(2026, () => 0)).toBe("ANALOG-2026-AAAA");
    expect(missionCode(2027)).toMatch(/^ANALOG-2027-[A-Z2-9]{4}$/);
  });

  test("el plan en texto deja claro que no es una reserva", () => {
    const plan: MissionPlan = {
      code: "ANALOG-2026-X94K",
      generatedAt: "2026-11-14T12:00:00Z",
      mission: "Prueba de movilidad",
      institution: "Agencia de prueba",
      site: { name: "Monte Etna", province: "Sicilia", country: "Italia", latitude: 37.75, longitude: 14.99 },
      reference: { name: "Haworth", world: "Luna", distance: 0.068, real: true },
      window: { year: 2027, quarter: "Jul–Sep", status: "Óptima", reasons: [] },
      team: { origin: "Quito, Ecuador", distanceKm: 10250.4, people: 4, cargoKg: 120, days: 10 },
      cost: estimateCampaign({ distanceKm: 10250.4, people: 4, cargoKg: 120, days: 10, seasonFactor: 1 }),
      robotTest: null,
      notes: PLAN_NOTES,
    };
    const text = planText(plan);
    expect(text).toContain("Código: ANALOG-2026-X94K");
    expect(text).toContain("Jul–Sep de 2027: Óptima");
    expect(text).toContain("similitud alta · 93 % de coincidencia de terreno (distancia 0.068)");
    expect(text).toContain("No es una reserva");
    expect(text).toContain("TOTAL:");
    expect(text).toContain("No se hizo la prueba del robot.");
    expect(planText({ ...plan, window: null })).toContain("Sin clima típico");
  });

  test("la prueba del robot entra en el plan con su punto de inicio", () => {
    const plan = {
      code: "ANALOG-2027-AAAA",
      generatedAt: "2026-11-15T12:00:00Z",
      mission: "Prueba de movilidad",
      institution: "Agencia de prueba",
      site: { name: "Monte Etna", province: "Sicilia", country: "Italia", latitude: 37.75, longitude: 14.99 },
      reference: { name: "Haworth", world: "Luna", distance: 0.068, real: true },
      window: null,
      team: { origin: "Quito, Ecuador", distanceKm: 10250.4, people: 4, cargoKg: 120, days: 10 },
      cost: estimateCampaign({ distanceKm: 10250.4, people: 4, cargoKg: 120, days: 10, seasonFactor: 1 }),
      robotTest: {
        vehicle: "VIPER",
        soil: "Arena seca",
        start: { latitude: 37.7412, longitude: 14.9821 },
        end: { latitude: 37.7425, longitude: 14.9833 },
        outcome: "atascado" as const,
        distanceM: 152.3,
        timeS: 1800,
        energyWh: 21.4,
        maxSlopeDeg: 4.2,
        maxSlipPercent: 88,
      },
      notes: PLAN_NOTES,
    } satisfies MissionPlan;
    const text = planText(plan);
    expect(text).toContain("Robot: VIPER   Suelo supuesto: Arena seca");
    expect(text).toContain("Inicio: 37.7412, 14.9821");
    expect(text).toContain("se atascó tras 152.3 m (30 min a velocidad real)");
  });
});
