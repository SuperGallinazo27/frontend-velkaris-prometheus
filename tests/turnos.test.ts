import { describe, expect, test } from "bun:test";
import { guard, hashOf, parseHash } from "../src/app/routes";
import type { StorageLike, User } from "../src/services/auth";
import { createHttpTurnos } from "../src/services/turnosHttp";
import { TURNOS_KEY, createLocalTurnos } from "../src/services/turnosLocal";
import { TurnoError } from "../src/services/turnosModel";
import {
  LIMITS,
  addDays,
  datasetPlace,
  datasetPlaces,
  datasetReason,
  datasetStateOf,
  daysIn,
  isIsoDate,
  nextFreeStart,
  overlaps,
  phaseOf,
  placeStatus,
  protectedSource,
  quarterStart,
  rangeProblem,
  rangeText,
  toIsoDate,
} from "../src/services/turnosRules";

// Filas reales de src/data/areasProtegidas.json (WDPCA, octubre de 2026).
const FREE = "pampa-de-la-joya";
const OTHER_FREE = "yungay";
const PERMIT = "arenal-del-chimborazo";
const STRICT = "sierra-negra";
const TODAY = "2026-11-15";

function memoryStorage(): StorageLike {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

const user = (id: string, role: User["role"], status: User["status"] = "activo"): User => ({
  id,
  email: `${id}@example.org`,
  role,
  status,
  createdAt: "2026-11-01T00:00:00.000Z",
  registeredAt: status === "activo" ? "2026-11-01T00:00:00.000Z" : null,
  profile: role === "agencia" && status === "activo"
    ? { fullName: "Ana Pérez", position: "", agency: `Agencia ${id.toUpperCase()}`, acronym: id.toUpperCase(), country: "Chile" }
    : null,
});

const admin = user("admin", "admin");
const one = user("uno", "agencia");
const two = user("dos", "agencia");

/** Portal de demostración con la sesión que se elija en cada paso. */
function portal() {
  const state = { session: one as User | null };
  const api = createLocalTurnos(memoryStorage(), () => state.session, () => new Date(2026, 10, 15, 12));
  return { api, as: (next: User | null) => void (state.session = next) };
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "sin error";
  } catch (error) {
    return error instanceof TurnoError ? error.code : String(error);
  }
}

async function errorOf(promise: Promise<unknown>): Promise<TurnoError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof TurnoError) return error;
    throw error;
  }
  throw new Error("se esperaba un error");
}

const request = (placeId = FREE, start = 30, end = 39) => ({
  placeId,
  startDate: addDays(TODAY, start),
  endDate: addDays(TODAY, end),
});

describe("regla de áreas protegidas", () => {
  test("los 37 lugares se clasifican con las categorías de la UICN", () => {
    expect(datasetPlaces).toHaveLength(37);
    const count = (state: string) => datasetPlaces.filter((place) => datasetStateOf(place.areas) === state).length;
    // Los mismos números que comprueba el servidor (tests/test_reservations.py).
    expect([count("protegido"), count("permiso"), count("libre"), count("sin_dato")]).toEqual([11, 7, 19, 0]);
  });

  test("Sierra Negra queda bloqueada por el Parque Nacional Galápagos, y dice por qué", () => {
    const sierra = datasetPlace(STRICT)!;
    expect(datasetStateOf(sierra.areas)).toBe("protegido");
    expect(sierra.areas!.find((area) => area.strict)).toMatchObject({ name: "Galápagos", iucn: "II", designation: "Parque Nacional" });
    expect(datasetReason(sierra.areas)).toBe(
      "Está dentro de Galápagos (Parque Nacional, categoría UICN II): protección estricta. PROMETHEUS no asigna turnos " +
        "en áreas de protección estricta (categorías UICN Ia a IV). Autoridad que la base informa: Ministry of Environment.",
    );
    const status = placeStatus(sierra, null);
    expect([status.status, status.bookable, status.permitRequired]).toEqual(["protegido", false, false]);
  });

  test("uso múltiple pide permiso; sin área, se reserva; junto a un parque, se avisa", () => {
    const chimborazo = placeStatus(datasetPlace(PERMIT)!, null);
    expect([chimborazo.status, chimborazo.bookable, chimborazo.permitRequired]).toEqual(["permiso", true, true]);
    expect(chimborazo.reason).toContain("Chimborazo (Reserva de Producción de Fauna, categoría UICN VI)");
    expect(chimborazo.reason).toContain("declarando el permiso");

    const joya = placeStatus(datasetPlace(FREE)!, null);
    expect([joya.status, joya.bookable, joya.permitRequired, joya.areas.length]).toEqual(["libre", true, false, 0]);

    const valley = placeStatus(datasetPlace("valle-de-la-muerte")!, null);
    expect(valley.status).toBe("libre");
    expect(valley.nearbyStrict.map((area) => `${area.name} ${area.iucn}`).sort()).toEqual(["Death Valley II", "Death Valley Ib"].sort());
    // Una categoría estricta decide aunque el mismo punto esté también en un área más permisiva.
    expect(datasetStateOf(datasetPlace("craters-of-the-moon")!.areas)).toBe("protegido");
    // Un nombre en otro alfabeto se muestra en inglés.
    expect(datasetPlace("crater-ramon")!.areas![0].name).toBe("Har Ha-Negev (harhava 3)");
    // Las designaciones se leen en español: los convenios se traducen; las nacionales quedan como
    // vienen si ya están en español y, si no, en el inglés de la base. Igual que en el servidor.
    expect(datasetReason(datasetPlace("tolbachik")!.areas)).toStartWith(
      "Está dentro de Volcanoes of Kamchatka (Sitio del Patrimonio Mundial natural o mixto, sin categoría UICN informada).",
    );
    expect(datasetReason(datasetPlace("askja")!.areas)).toContain("Vatnajökulsþjóðgarður (National Park, categoría UICN II)");
  });

  test("la decisión del administrador manda sobre la base", () => {
    const stamp = "2026-11-15T00:00:00.000Z";
    const closed = placeStatus(datasetPlace(FREE)!, { mode: "cerrado", reason: "Carretera cortada.", updatedAt: stamp });
    expect([closed.status, closed.bookable, closed.datasetStatus]).toEqual(["cerrado", false, "libre"]);
    expect(closed.reason).toBe("Cerrado por el administrador: Carretera cortada.");

    const enabled = placeStatus(datasetPlace(STRICT)!, { mode: "habilitado", reason: "Permiso DPNG PC-12-27.", updatedAt: stamp });
    expect([enabled.status, enabled.bookable, enabled.permitRequired]).toEqual(["habilitado", true, true]);
    expect(enabled.reason).toContain("Galápagos");
    expect(enabled.reason).toContain("Permiso DPNG PC-12-27.");

    // Habilitar un lugar que la base no bloquea no cambia nada.
    const needless = placeStatus(datasetPlace(FREE)!, { mode: "habilitado", reason: "x", updatedAt: stamp });
    expect([needless.status, needless.override]).toEqual(["libre", null]);
  });

  test("la fuente lleva la cita y el mes de la versión", () => {
    expect(protectedSource.citation).toStartWith("UNEP-WCMC and IUCN");
    expect(protectedSource.url).toBe("https://www.protectedplanet.net/");
    expect(protectedSource.release).toMatch(/^[A-Z][a-z]+ \d{4}$/);
  });
});

describe("fechas de un turno", () => {
  test("operaciones con días", () => {
    expect(toIsoDate(new Date(2027, 2, 3))).toBe("2027-03-03");
    expect(addDays("2027-02-27", 3)).toBe("2027-03-02");
    expect(addDays("2027-01-01", -1)).toBe("2026-12-31");
    expect(daysIn("2027-03-03", "2027-03-12")).toBe(10);
    expect(daysIn("2027-03-03", "2027-03-03")).toBe(1);
    expect(isIsoDate("2027-02-28")).toBe(true);
    expect(isIsoDate("2027-02-30")).toBe(false);
    expect(isIsoDate("03/01/2027")).toBe(false);
  });

  test("dos turnos se pisan si comparten un día", () => {
    expect(overlaps("2027-03-01", "2027-03-10", "2027-03-10", "2027-03-12")).toBe(true);
    expect(overlaps("2027-03-01", "2027-03-10", "2027-03-11", "2027-03-12")).toBe(false);
    expect(overlaps("2027-03-05", "2027-03-06", "2027-03-01", "2027-03-10")).toBe(true);
  });

  test("los rangos se leen con naturalidad", () => {
    expect(rangeText("2027-03-03", "2027-03-12")).toBe("del 3 al 12 de marzo de 2027");
    expect(rangeText("2027-02-28", "2027-03-04")).toBe("del 28 de febrero al 4 de marzo de 2027");
    expect(rangeText("2026-12-30", "2027-01-02")).toBe("del 30 de diciembre de 2026 al 2 de enero de 2027");
    expect(rangeText("2027-03-03", "2027-03-03")).toBe("el 3 de marzo de 2027");
  });

  test("límites: ni pasado, ni más de 60 días, ni más de 24 meses", () => {
    expect(rangeProblem(addDays(TODAY, 10), addDays(TODAY, 9), TODAY)).toBe("La fecha de fin no puede ser anterior a la de inicio.");
    expect(rangeProblem(addDays(TODAY, -2), addDays(TODAY, 3), TODAY)).toBe("La fecha de inicio ya pasó.");
    expect(rangeProblem(addDays(TODAY, -1), TODAY, TODAY)).toBeNull();
    expect(rangeProblem(addDays(TODAY, 10), addDays(TODAY, 70), TODAY)).toBe("Un turno dura como máximo 60 días.");
    expect(rangeProblem(addDays(TODAY, 10), addDays(TODAY, 69), TODAY)).toBeNull();
    expect(rangeProblem(addDays(TODAY, 731), addDays(TODAY, 735), TODAY)).toBe("Solo se reserva con hasta 24 meses de anticipación.");
    expect(rangeProblem("", addDays(TODAY, 3), TODAY)).toBe("Elige una fecha de inicio y una de fin válidas.");
  });

  test("fase de un turno según el día", () => {
    expect(phaseOf("reservado", "2026-11-20", "2026-11-25", TODAY)).toBe("proximo");
    expect(phaseOf("reservado", "2026-11-10", "2026-11-15", TODAY)).toBe("en_curso");
    expect(phaseOf("reservado", "2026-11-01", "2026-11-14", TODAY)).toBe("terminado");
    expect(phaseOf("cancelado", "2026-11-20", "2026-11-25", TODAY)).toBe("cancelado");
  });

  test("primer hueco libre y primer día de un trimestre", () => {
    const busy = [
      { startDate: "2027-03-01", endDate: "2027-03-10" },
      { startDate: "2027-03-13", endDate: "2027-03-20" },
    ];
    expect(nextFreeStart(busy, "2027-03-05", 5, TODAY)).toBe("2027-03-21");
    expect(nextFreeStart(busy, "2027-03-05", 2, TODAY)).toBe("2027-03-11");
    expect(nextFreeStart(busy, "2027-02-01", 5, TODAY)).toBe("2027-02-01");
    expect(nextFreeStart([{ startDate: TODAY, endDate: addDays(TODAY, 800) }], TODAY, 5, TODAY)).toBeNull();
    expect(quarterStart(2027, 1, TODAY)).toBe("2027-04-01");
    // El trimestre en curso ya empezó, y un plan sin ventana no tiene trimestre: dentro de una semana.
    expect(quarterStart(2026, 3, TODAY)).toBe("2026-11-22");
    expect(quarterStart(2027, null, TODAY)).toBe("2026-11-22");
  });
});

describe("portal de demostración (sin servidor)", () => {
  test("una agencia reserva un lugar libre y queda confirmado al instante", async () => {
    const { api } = portal();
    const turno = await api.book({ ...request(), mission: " Prueba de movilidad ", robot: "VIPER", people: 4, estimatedCostUsd: 18250 });
    expect(turno.code).toMatch(/^TUR-[A-HJ-NP-Z2-9]{6}$/);
    expect(turno).toMatchObject({
      placeId: FREE,
      placeName: "Pampa de La Joya",
      days: 10,
      status: "reservado",
      phase: "proximo",
      permitReference: null,
      mission: "Prueba de movilidad",
      robot: "VIPER",
      people: 4,
      estimatedCostUsd: 18250,
    });
    expect(turno.agency).toMatchObject({ userId: "uno", agency: "Agencia UNO" });
    expect((await api.mine()).map((r) => r.id)).toEqual([turno.id]);
    const status = (await api.places()).find((place) => place.id === FREE)!;
    expect([status.activeReservations, status.occupiedToday]).toEqual([1, false]);
  });

  test("otra agencia encuentra el lugar ocupado, sin saber de quién es", async () => {
    const { api, as } = portal();
    await api.book(request(FREE, 30, 39));
    as(two);
    for (const [start, end] of [[30, 39], [25, 30], [39, 45], [32, 35], [20, 50]]) {
      const error = await errorOf(api.book(request(FREE, start, end)));
      expect(error.code).toBe("ocupado");
      expect(error.message).toBe(`Ocupado: otra agencia tiene este lugar ${rangeText(addDays(TODAY, 30), addDays(TODAY, 39))}.`);
      expect(error.busy).toEqual([{ startDate: addDays(TODAY, 30), endDate: addDays(TODAY, 39), mine: false, agency: null }]);
    }
    expect((await api.availability(FREE)).busy).toEqual([
      { startDate: addDays(TODAY, 30), endDate: addDays(TODAY, 39), mine: false, agency: null },
    ]);
    // El día anterior, el siguiente y cualquier otro lugar están libres.
    await api.book(request(FREE, 20, 29));
    await api.book(request(FREE, 40, 44));
    await api.book(request(OTHER_FREE, 30, 39));
    as(admin);
    expect((await api.availability(FREE)).busy.map((range) => range.agency)).toEqual(["Agencia DOS", "Agencia UNO", "Agencia DOS"]);
    as(one);
    const own = await errorOf(api.book(request(FREE, 35, 36)));
    expect(own.message).toStartWith("Tu agencia ya tiene este lugar");
  });

  test("área estricta: no se reserva; uso múltiple: solo con permiso", async () => {
    const { api } = portal();
    const blocked = await errorOf(api.book({ ...request(STRICT), permitReference: "DPNG-1" }));
    expect(blocked.code).toBe("bloqueado");
    expect(blocked.message).toContain("Sierra Negra no se puede reservar.");
    expect(blocked.message).toContain("Galápagos (Parque Nacional, categoría UICN II)");

    expect(await codeOf(api.book(request(PERMIT)))).toBe("permiso");
    expect(await codeOf(api.book({ ...request(PERMIT), permitReference: "   " }))).toBe("permiso");
    const turno = await api.book({ ...request(PERMIT), permitReference: "  MAATE-RPFCH-2027-014 " });
    expect(turno.permitReference).toBe("MAATE-RPFCH-2027-014");
    // Un permiso enviado para un lugar que no lo pide no se guarda.
    expect((await api.book({ ...request(FREE), permitReference: "no hace falta" })).permitReference).toBeNull();
  });

  test("fechas, lugar desconocido y límite de cinco turnos activos", async () => {
    const { api } = portal();
    expect(await codeOf(api.book(request(FREE, 10, 9)))).toBe("fechas");
    expect(await codeOf(api.book(request(FREE, -2, 3)))).toBe("fechas");
    expect(await codeOf(api.book(request(FREE, 10, 70)))).toBe("fechas");
    expect(await codeOf(api.book(request("no-existe")))).toBe("no-encontrado");
    expect(await api.mine()).toEqual([]);

    const free = datasetPlaces.filter((place) => datasetStateOf(place.areas) === "libre").map((place) => place.id);
    const turnos = [];
    for (const placeId of free.slice(0, LIMITS.maxActivePerAgency)) turnos.push(await api.book(request(placeId)));
    expect(await codeOf(api.book(request(free[5])))).toBe("limite");
    await api.cancel(turnos[0].id);
    expect((await api.book(request(free[5]))).status).toBe("reservado");
  });

  test("cancelar: la agencia, lo suyo; el administrador, con motivo", async () => {
    const { api, as } = portal();
    const first = await api.book(request(FREE, 30, 34));
    const second = await api.book(request(OTHER_FREE, 30, 34));
    as(two);
    expect(await codeOf(api.cancel(first.id))).toBe("no-encontrado");
    as(one);
    const cancelled = await api.cancel(first.id, " Cambio de fechas ");
    expect(cancelled).toMatchObject({ status: "cancelado", phase: "cancelado", cancelledBy: "agencia", cancelReason: "Cambio de fechas" });
    expect(await codeOf(api.cancel(first.id))).toBe("ya-cancelado");
    as(two);
    expect((await api.book(request(FREE, 30, 34))).status).toBe("reservado");

    as(admin);
    expect(await codeOf(api.cancel(second.id))).toBe("motivo");
    expect(await codeOf(api.cancel(second.id, "  "))).toBe("motivo");
    await api.cancel(second.id, "El acceso por carretera está cortado");
    expect(await codeOf(api.cancel("no-existe", "x"))).toBe("no-encontrado");
    as(one);
    const seen = (await api.mine()).find((r) => r.id === second.id)!;
    expect(seen).toMatchObject({ status: "cancelado", cancelledBy: "admin", cancelReason: "El acceso por carretera está cortado" });
  });

  test("un turno terminado ya no ocupa ni se puede cancelar", async () => {
    const storage = memoryStorage();
    let now = new Date(2026, 10, 15, 12);
    const api = createLocalTurnos(storage, () => one, () => now);
    const turno = await api.book({ placeId: FREE, startDate: TODAY, endDate: addDays(TODAY, 4) });
    expect(turno.phase).toBe("en_curso");
    expect((await api.availability(FREE)).place.occupiedToday).toBe(true);
    now = new Date(2026, 10, 25, 12);
    expect((await api.mine())[0].phase).toBe("terminado");
    expect(await codeOf(api.cancel(turno.id))).toBe("terminado");
    expect((await api.availability(FREE)).busy).toEqual([]);
  });

  test("el administrador ve todo, cierra y habilita lugares; no reserva", async () => {
    const { api, as } = portal();
    await api.book(request(FREE, 30, 34));
    expect(await codeOf(api.all())).toBe("sin-permiso");
    expect(await codeOf(api.setOverride(FREE, "cerrado", "x"))).toBe("sin-permiso");
    expect(await codeOf(api.clearOverride(FREE))).toBe("sin-permiso");

    as(admin);
    expect(await codeOf(api.book(request(OTHER_FREE)))).toBe("sin-permiso");
    expect((await api.all()).map((r) => r.agency?.agency)).toEqual(["Agencia UNO"]);
    expect(await codeOf(api.setOverride(FREE, "cerrado", "  "))).toBe("motivo");
    expect(await codeOf(api.setOverride(FREE, "habilitado", "x"))).toBe("no-bloqueado");
    const closed = await api.setOverride(FREE, "cerrado", "Carretera cortada por lluvias.");
    expect([closed.status, closed.activeReservations]).toEqual(["cerrado", 1]);
    as(one);
    const blocked = await errorOf(api.book(request(FREE, 50, 52)));
    expect(blocked.code).toBe("bloqueado");
    expect(blocked.message).toContain("Carretera cortada por lluvias.");
    as(admin);
    expect((await api.clearOverride(FREE)).status).toBe("libre");

    const enabled = await api.setOverride(STRICT, "habilitado", "Permiso de investigación DPNG PC-12-27.");
    expect([enabled.status, enabled.bookable, enabled.permitRequired]).toEqual(["habilitado", true, true]);
    as(one);
    expect(await codeOf(api.book(request(STRICT)))).toBe("permiso");
    expect((await api.book({ ...request(STRICT), permitReference: "DPNG PC-12-27" })).permitReference).toBe("DPNG PC-12-27");
  });

  test("sin sesión o con el registro pendiente no hay portal", async () => {
    const { api, as } = portal();
    as(null);
    expect(await codeOf(api.places())).toBe("sin-sesion");
    expect(await codeOf(api.book(request()))).toBe("sin-sesion");
    as(user("nuevo", "agencia", "pendiente"));
    expect(await codeOf(api.places())).toBe("sin-permiso");
    expect(await codeOf(api.mine())).toBe("sin-permiso");
  });

  test("avisa de cada cambio y sobrevive a un almacenamiento dañado", async () => {
    const storage = memoryStorage();
    storage.setItem(TURNOS_KEY, "{no es json");
    const api = createLocalTurnos(storage, () => one, () => new Date(2026, 10, 15, 12));
    let changes = 0;
    const stop = api.subscribe(() => changes++);
    expect(await api.mine()).toEqual([]);
    const turno = await api.book(request());
    await api.cancel(turno.id);
    expect(changes).toBe(2);
    stop();
    await api.book(request());
    expect(changes).toBe(2);
  });
});

describe("portal con servidor", () => {
  const rawPlace = {
    id: STRICT,
    name: "Sierra Negra",
    province: "Galápagos",
    country: "Ecuador",
    status: "protegido",
    bookable: false,
    permit_required: false,
    reason: "Está dentro de Galápagos.",
    dataset_status: "protegido",
    areas: [
      {
        site_id: 187,
        name: "Galápagos",
        name_eng: "Galápagos",
        designation: "Parque Nacional",
        designation_eng: "National Park",
        designation_type: "National",
        iucn: "II",
        status: "Designated",
        status_year: 1996,
        governance: "Federal or national ministry or agency",
        authority: "Ministry of Environment",
        iso3: "ECU",
        strict: true,
      },
    ],
    nearby_strict: [],
    override: { mode: "cerrado", reason: "Erupción.", updated_at: "2026-11-15T10:00:00.000Z" },
    occupied_today: false,
    active_reservations: 2,
  };
  const rawReservation = {
    id: "0f0f0f0f-0000-4000-8000-000000000001",
    code: "TUR-7K3Q9D",
    place_id: FREE,
    place_name: "Pampa de La Joya",
    start_date: "2027-03-03",
    end_date: "2027-03-12",
    days: 10,
    status: "reservado",
    phase: "proximo",
    permit_reference: null,
    mission: "Prueba",
    robot: "VIPER",
    people: 4,
    estimated_cost_usd: 18250,
    created_at: "2026-11-15T10:00:00.000Z",
    cancelled_at: null,
    cancelled_by: null,
    cancel_reason: null,
    agency: { user_id: "u1", email: "uno@example.org", agency: "Agencia UNO", acronym: "UNO", country: "Chile" },
  };

  /** Servidor simulado: responde lo que se le indique y guarda lo que recibió. */
  function server(reply: (method: string, path: string) => { status: number; body: unknown }) {
    const calls: { method: string; path: string; headers: Record<string, string>; body: unknown }[] = [];
    const fetcher = (async (url: string, init?: RequestInit) => {
      const path = url.replace("https://api.example.org/api/v1", "");
      const method = init?.method ?? "GET";
      calls.push({
        method,
        path,
        headers: init?.headers as Record<string, string>,
        body: init?.body ? JSON.parse(init.body as string) : undefined,
      });
      const { status, body } = reply(method, path);
      return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;
    return { calls, fetcher };
  }

  test("envía el token y el cuerpo que espera el servidor, sin campos vacíos", async () => {
    const { calls, fetcher } = server(() => ({ status: 201, body: rawReservation }));
    const api = createHttpTurnos("https://api.example.org/", () => "TOKEN", () => {}, fetcher);
    let changes = 0;
    api.subscribe(() => changes++);
    const turno = await api.book({
      placeId: FREE,
      startDate: "2027-03-03",
      endDate: "2027-03-12",
      permitReference: "  ",
      mission: " Prueba ",
      robot: undefined,
      people: 4,
    });
    expect(calls).toEqual([
      {
        method: "POST",
        path: "/reservations",
        headers: { Authorization: "Bearer TOKEN", "Content-Type": "application/json" },
        body: { place_id: FREE, start_date: "2027-03-03", end_date: "2027-03-12", mission: "Prueba", people: 4 },
      },
    ]);
    expect(turno).toMatchObject({
      code: "TUR-7K3Q9D",
      placeId: FREE,
      startDate: "2027-03-03",
      days: 10,
      phase: "proximo",
      estimatedCostUsd: 18250,
      agency: { userId: "u1", agency: "Agencia UNO" },
    });
    expect(changes).toBe(1);
  });

  test("convierte los lugares y los turnos del servidor", async () => {
    const { calls, fetcher } = server((_method, path) =>
      path === "/places"
        ? { status: 200, body: { places: [rawPlace] } }
        : path.endsWith("/availability")
          ? { status: 200, body: { place: rawPlace, busy: [{ start_date: "2027-03-03", end_date: "2027-03-12", mine: false, agency: "Agencia UNO" }], today: TODAY } }
          : { status: 200, body: { reservations: [rawReservation] } },
    );
    const api = createHttpTurnos("https://api.example.org", () => "TOKEN", () => {}, fetcher);
    const [place] = await api.places();
    expect(place).toMatchObject({
      id: STRICT,
      status: "protegido",
      bookable: false,
      permitRequired: false,
      datasetStatus: "protegido",
      activeReservations: 2,
      override: { mode: "cerrado", reason: "Erupción.", updatedAt: "2026-11-15T10:00:00.000Z" },
    });
    expect(place.areas[0]).toMatchObject({ siteId: 187, name: "Galápagos", iucn: "II", statusYear: 1996, strict: true });
    const availability = await api.availability(STRICT);
    expect(availability.busy).toEqual([{ startDate: "2027-03-03", endDate: "2027-03-12", mine: false, agency: "Agencia UNO" }]);
    expect(availability.today).toBe(TODAY);
    expect((await api.mine())[0].code).toBe("TUR-7K3Q9D");
    expect((await api.all())[0].agency?.email).toBe("uno@example.org");
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /places",
      `GET /places/${STRICT}/availability`,
      "GET /reservations/mine",
      "GET /reservations",
    ]);
    expect(calls.every((call) => call.headers.Authorization === "Bearer TOKEN" && call.body === undefined)).toBe(true);
  });

  test("ocupado: trae los días que chocan y el mensaje se arma aquí", async () => {
    const { fetcher } = server(() => ({
      status: 409,
      body: { detail: { code: "place_busy", message: "(servidor)", busy: [{ start_date: "2027-03-03", end_date: "2027-03-12", mine: false }] } },
    }));
    const api = createHttpTurnos("https://api.example.org", () => "TOKEN", () => {}, fetcher);
    const error = await errorOf(api.book({ placeId: FREE, startDate: "2027-03-05", endDate: "2027-03-06" }));
    expect(error.code).toBe("ocupado");
    expect(error.message).toBe("Ocupado: otra agencia tiene este lugar del 3 al 12 de marzo de 2027.");
    expect(error.busy).toEqual([{ startDate: "2027-03-03", endDate: "2027-03-12", mine: false, agency: null }]);
  });

  test("códigos del servidor, sesión vencida y servidor apagado", async () => {
    const codes: [number, string, string][] = [
      [409, "place_blocked", "bloqueado"],
      [422, "permit_required", "permiso"],
      [422, "invalid_dates", "fechas"],
      [409, "too_many_reservations", "limite"],
      [404, "place_not_found", "no-encontrado"],
      [404, "reservation_not_found", "no-encontrado"],
      [409, "already_cancelled", "ya-cancelado"],
      [409, "reservation_finished", "terminado"],
      [422, "reason_required", "motivo"],
      [409, "not_blocked", "no-bloqueado"],
      [403, "forbidden", "sin-permiso"],
      [500, "otra_cosa", "servidor"],
    ];
    for (const [status, code, expected] of codes) {
      const { fetcher } = server(() => ({ status, body: { detail: { code, message: "Mensaje del servidor." } } }));
      const api = createHttpTurnos("https://api.example.org", () => "TOKEN", () => {}, fetcher);
      expect(await codeOf(api.cancel("x", "motivo"))).toBe(expected);
    }
    const blocked = server(() => ({ status: 409, body: { detail: { code: "place_blocked", message: "Sierra Negra no se puede reservar." } } }));
    const api = createHttpTurnos("https://api.example.org", () => "TOKEN", () => {}, blocked.fetcher);
    expect((await errorOf(api.book({ placeId: STRICT, startDate: "2027-03-05", endDate: "2027-03-06" }))).message).toBe(
      "Sierra Negra no se puede reservar.",
    );

    let signedOut = 0;
    const expired = server(() => ({ status: 401, body: { detail: { code: "session_expired", message: "La sesión expiró." } } }));
    const stale = createHttpTurnos("https://api.example.org", () => "VIEJO", () => signedOut++, expired.fetcher);
    expect(await codeOf(stale.mine())).toBe("sin-sesion");
    expect(signedOut).toBe(1);

    const none = server(() => ({ status: 200, body: {} }));
    const anonymous = createHttpTurnos("https://api.example.org", () => null, () => {}, none.fetcher);
    expect(await codeOf(anonymous.places())).toBe("sin-sesion");
    expect(none.calls).toEqual([]);

    // Un servidor anterior al portal responde 404 sin código: se explica en vez de fallar en silencio.
    const old = server(() => ({ status: 404, body: { detail: "Not Found" } }));
    const outdated = createHttpTurnos("https://api.example.org", () => "TOKEN", () => {}, old.fetcher);
    const missing = await errorOf(outdated.places());
    expect([missing.code, missing.message]).toEqual([
      "servidor",
      "Este servidor todavía no tiene el portal de turnos. Reinicia la API para cargar la versión nueva.",
    ]);

    const down = createHttpTurnos("https://api.example.org", () => "TOKEN", () => {}, (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch);
    expect(await codeOf(down.places())).toBe("servidor");
  });

  test("decisiones del administrador sobre un lugar", async () => {
    const { calls, fetcher } = server(() => ({ status: 200, body: rawPlace }));
    const api = createHttpTurnos("https://api.example.org", () => "TOKEN", () => {}, fetcher);
    expect((await api.setOverride(STRICT, "cerrado", "Erupción.")).status).toBe("protegido");
    await api.clearOverride(STRICT);
    await api.cancel("abc", "  Motivo ");
    expect(calls.map((call) => [call.method, call.path, call.body])).toEqual([
      ["POST", `/places/${STRICT}/override`, { mode: "cerrado", reason: "Erupción." }],
      ["DELETE", `/places/${STRICT}/override`, undefined],
      ["POST", "/reservations/abc/cancel", { reason: "Motivo" }],
    ]);
  });
});

describe("pantalla «Mis turnos»", () => {
  test("es de las agencias con registro completo", () => {
    expect(parseHash("#turnos")).toEqual({ screen: "turnos" });
    expect(hashOf({ screen: "turnos" })).toBe("#turnos");
    const route = { screen: "turnos" } as const;
    expect(guard(route, null)).toEqual({ screen: "login" });
    expect(guard(route, one)).toBe(route);
    expect(guard(route, admin)).toEqual({ screen: "admin" });
    expect(guard(route, user("nuevo", "agencia", "pendiente"))).toEqual({ screen: "registro" });
  });
});
