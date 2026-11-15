import { describe, expect, test } from "bun:test";
import { placeContext } from "../src/features/ai/context";
import type { CopilotFacts } from "../src/features/ai/context";
import type { MissionPlan } from "../src/features/mission/campaign";
import { seasonOf } from "../src/features/world/climate";
import { matchZones } from "../src/features/world/hierarchy";
import { lunarRegions, zonesFor } from "../src/features/world/lunar";
import { ENSO_SNAPSHOT } from "../src/services/enso";
import { AssistantError, askAssistant } from "../src/services/assistant";

const region = lunarRegions.find((r) => r.id === "mons-mouton-plateau")!;
const match = matchZones(zonesFor(region), [region]).find((m) => m.zone.id === "sierra-negra")!;

const facts = (overrides: Partial<CopilotFacts> = {}): CopilotFacts => ({
  match,
  real: true,
  elevation: 1050,
  season: seasonOf("sierra-negra", match.zone.latitude, 1050),
  month: 10,
  rain: { totalMm: 426, days: 30, from: "2026-10-16", to: "2026-11-14", wettestMm: 75.8 },
  enso: ENSO_SNAPSHOT,
  booking: { status: "no reservable", reason: "Dentro del Parque Nacional Galápagos (UICN II)." },
  robotTest: null,
  plan: null,
  ...overrides,
});

const plan: MissionPlan = {
  code: "ANALOG-2027-TEST",
  generatedAt: "2026-11-15T00:00:00.000Z",
  mission: "Prueba de movilidad",
  institution: "Agencia Secreta de Prueba",
  site: { name: "Sierra Negra", province: "Galápagos", country: "Ecuador", latitude: -0.83, longitude: -91.17 },
  reference: { name: region.name, world: "Luna", distance: match.distance, real: true },
  window: { year: 2027, quarter: "Julio a septiembre", status: "Óptima", reasons: [] },
  team: { origin: "Quito", distanceKm: 1400, people: 4, cargoKg: 150, days: 10 },
  cost: { flights: 1, cargo: 2, field: 3, permits: 4, contingency: 5, total: 15, perDay: 1.5 } as MissionPlan["cost"],
  robotTest: null,
  notes: ["No es una reserva."],
};

describe("datos que recibe el copiloto", () => {
  test("lleva el terreno, el clima de ahora, la temperatura, el suelo y los turnos", () => {
    const context = placeContext(facts()) as Record<string, any>;
    expect(context.lugar).toMatchObject({ nombre: "Sierra Negra", pais: "Ecuador", altitud_m: 1050 });
    expect(context.comparacion_de_terreno.con).toBe(`${region.name} (Luna)`);
    expect(context.comparacion_de_terreno.coincidencia_pct).toBeGreaterThan(0);
    expect(context.comparacion_de_terreno.datos).toContain("reales");
    expect(context.clima.ultimos_30_dias).toMatchObject({ lluvia_mm: 426, estado: "llueve mucho más de lo típico", valoracion_ahora: "difícil" });
    expect(context.clima.tipico_del_mes.valoracion_para_trabajo_de_campo).toBe("favorable");
    expect(context.clima.el_nino).toContain("El Niño muy fuerte activo");
    expect(context.temperatura_del_suelo.aqui_c.de_dia).toHaveLength(4);
    expect(context.temperatura_del_suelo.en_la_region_lunar_c.minima).toBeLessThan(-150);
    expect(context.suelo).toBeDefined();
    // Sierra Negra: las fotos cercanas no muestran el suelo, así que no hay lectura que enviar.
    expect(context.lectura_de_fotos).toBeUndefined();
    expect(context.como_se_llega.aeropuerto).toContain("IBB");
    expect(context.turnos).toMatchObject({ estado: "no reservable" });
    expect(context.prueba_del_robot).toBeUndefined();
    expect(context.plan_de_campana).toBeUndefined();
  });

  test("lo que no se sabe no se envía ni se rellena", () => {
    const context = placeContext(facts({ rain: null, enso: null, booking: null, season: null })) as Record<string, any>;
    expect(context.clima).toBeUndefined();
    expect(context.turnos).toBeUndefined();
    const demo = placeContext(facts({ real: false })) as Record<string, any>;
    expect(demo.comparacion_de_terreno.datos).toContain("sintéticos");
    expect(demo.temperatura_del_suelo.en_la_region_lunar_c).toBeNull();
  });

  test("el plan viaja sin el nombre de la institución y todo cabe en el límite del servidor", () => {
    const context = placeContext(facts({ plan }));
    const text = JSON.stringify(context);
    expect((context.plan_de_campana as Record<string, any>).mision).toBe("Prueba de movilidad");
    expect(text).not.toContain("Agencia Secreta de Prueba");
    expect(text.length).toBeLessThan(12_000);
  });
});

describe("consulta al copiloto", () => {
  const respond = (body: unknown, status = 200) => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetcher = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(body), { status });
    }) as unknown as typeof fetch;
    return { fetcher, calls };
  };

  test("envía la pregunta con el token y devuelve la respuesta", async () => {
    const { fetcher, calls } = respond({ answer: " Hola. ", model: "gemini-3.5-flash" });
    const result = await askAssistant("pregunta", { lugar: "x" }, " ¿Conviene? ", { fetcher, base: "http://api.test/", token: "TOKEN-DE-PRUEBA" });
    expect(result).toEqual({ answer: "Hola.", model: "gemini-3.5-flash" });
    expect(calls[0].url).toBe("http://api.test/api/v1/assistant/ask");
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe("Bearer TOKEN-DE-PRUEBA");
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ kind: "pregunta", question: "¿Conviene?", context: { lugar: "x" } });
  });

  test("sin servidor o sin sesión no llama a nadie", async () => {
    const { fetcher, calls } = respond({});
    await expect(askAssistant("explicar", {}, undefined, { fetcher, base: "", token: "t" })).rejects.toMatchObject({ code: "sin-servidor" });
    await expect(askAssistant("explicar", {}, undefined, { fetcher, base: "http://api.test", token: null })).rejects.toMatchObject({ code: "sin-sesion" });
    expect(calls).toHaveLength(0);
  });

  test("muestra el mensaje del servidor y reconoce un servidor sin copiloto", async () => {
    const limit = respond({ detail: { code: "assistant_limit", message: "Llegó al límite." } }, 429);
    const error = await askAssistant("explicar", {}, undefined, { fetcher: limit.fetcher, base: "http://api.test", token: "t" }).catch((e) => e);
    expect(error).toBeInstanceOf(AssistantError);
    expect(error).toMatchObject({ code: "limite", message: "Llegó al límite." });
    const old = respond({ detail: "Not Found" }, 404);
    await expect(askAssistant("explicar", {}, undefined, { fetcher: old.fetcher, base: "http://api.test", token: "t" })).rejects.toThrow(/reiniciar la API/);
    const empty = respond({ answer: "  " });
    await expect(askAssistant("explicar", {}, undefined, { fetcher: empty.fetcher, base: "http://api.test", token: "t" })).rejects.toMatchObject({ code: "servidor" });
  });
});
