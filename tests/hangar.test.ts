import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { guard, hashOf, parseHash } from "../src/app/routes";
import { HANGAR_CHECKED, dateText, hangarOf, isPlanned, periodText } from "../src/features/hangar/hangarData";
import type { MissionInfo, SourceRef } from "../src/features/hangar/hangarData";
import { LOG_LIMIT, clearLog, preferredRobot, readLog, saveLogEntry, setPreferredRobot, summarize } from "../src/features/hangar/logbook";
import type { NewLogEntry } from "../src/features/hangar/logbook";
import { HOLO_ROBOTS, ROBOT_PARTS, isHoloRobot } from "../src/features/hangar/parts";
import { ROBOTS } from "../src/features/mission/robots";
import english from "../src/i18n/en.json";
import { createTranslator } from "../src/i18n/translator";
import type { Dictionary } from "../src/i18n/translator";
import type { User } from "../src/services/auth";

const okSource = (source: SourceRef, where: string) => {
  expect(source.url, where).toStartWith("https://");
  expect(source.title.length, where).toBeGreaterThan(3);
};

describe("datos del hangar", () => {
  test("cada robot con holograma tiene todos sus componentes, con datos y fuente", () => {
    for (const robot of HOLO_ROBOTS) {
      const info = hangarOf(robot)!;
      expect(Object.keys(info.components).sort(), robot).toEqual([...ROBOT_PARTS[robot]].sort());
      for (const [part, item] of Object.entries(info.components)) {
        const where = `${robot}/${part}`;
        expect(item.name.length, where).toBeGreaterThan(2);
        expect(item.what.length, where).toBeGreaterThan(20);
        expect(item.facts.length, where).toBeGreaterThanOrEqual(2);
        for (const fact of item.facts) {
          expect(fact.label.trim(), where).toBe(fact.label);
          expect(fact.value.length, where).toBeGreaterThan(0);
          okSource(fact.source, where);
        }
        for (const entry of item.heritage) {
          expect(entry.year, where).toBeGreaterThan(1960);
          expect(entry.note.length, where).toBeGreaterThan(10);
          okSource(entry.source, where);
        }
        // La herencia va en orden de tiempo.
        expect(item.heritage.map((entry) => entry.year), where).toEqual([...item.heritage.map((entry) => entry.year)].sort((a, b) => a - b));
      }
    }
  });

  test("todos los robots del catálogo tienen historial con hitos fechados y fuente", () => {
    for (const robot of ROBOTS) {
      const info = hangarOf(robot.id);
      expect(info, robot.id).not.toBeNull();
      expect(info!.missions.length, robot.id).toBeGreaterThan(0);
      for (const mission of info!.missions) {
        expect(mission.summary.length, robot.id).toBeGreaterThan(20);
        okSource(mission.source, robot.id);
        expect(mission.milestones.length, robot.id).toBeGreaterThanOrEqual(2);
        for (const milestone of mission.milestones) {
          expect(milestone.date, robot.id).toMatch(/^\d{4}-\d{2}(-\d{2})?$/);
          okSource(milestone.source, robot.id);
        }
        // Los hitos van en orden de tiempo.
        const dates = mission.milestones.map((milestone) => milestone.date);
        expect(dates, mission.name).toEqual([...dates].sort());
      }
    }
    // El carro lunar voló en tres misiones; los robots sin forma 3D no tienen componentes.
    expect(hangarOf("lrv")!.missions.map((mission) => mission.name)).toEqual(["Apolo 15", "Apolo 16", "Apolo 17"]);
    for (const robot of ROBOTS) if (!isHoloRobot(robot.id)) expect(Object.keys(hangarOf(robot.id)!.components)).toHaveLength(0);
    expect(hangarOf("no-existe")).toBeNull();
    expect(HANGAR_CHECKED).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test("la investigación guarda la cita textual de cada dato", () => {
    const folder = join(import.meta.dir, "..", "scripts", "hangar", "investigacion");
    const files = readdirSync(folder).filter((name) => name.endsWith(".json"));
    expect(files).toHaveLength(4);
    let quotes = 0;
    const check = (entry: { quote?: string; source?: SourceRef }, where: string) => {
      expect(entry.quote?.trim().length ?? 0, where).toBeGreaterThan(8);
      expect(entry.source?.url ?? "", where).toStartWith("https://");
      quotes++;
    };
    for (const name of files) {
      const data = JSON.parse(readFileSync(join(folder, name), "utf8"));
      for (const item of Object.values(data.components) as { facts: object[]; heritage: object[] }[]) {
        item.facts.forEach((fact) => check(fact, name));
        item.heritage.forEach((entry) => check(entry, name));
      }
      for (const mission of data.missions as { milestones: object[] }[]) mission.milestones.forEach((milestone) => check(milestone, name));
      for (const other of Object.values(data.others ?? {}) as { milestones: object[] }[]) other.milestones.forEach((milestone) => check(milestone, name));
    }
    expect(quotes).toBeGreaterThan(180);
  });

  test("fechas y periodos en frases", () => {
    expect(dateText("2021-02-18")).toBe("18 de febrero de 2021");
    expect(dateText("2024-08")).toBe("agosto de 2024");
    expect(dateText("1971")).toBe("1971");
    const mission = (start: string | null, end: string | null) => ({ start, end }) as MissionInfo;
    expect(periodText(mission("1971-07-26", "1971-08-07"))).toBe("Del 26 de julio de 1971 al 7 de agosto de 1971");
    expect(periodText(mission("2020-07-30", null))).toBe("Lanzada el 30 de julio de 2020 · sigue en curso");
    expect(periodText(mission(null, null))).toBe("Todavía no ha volado");
    const heritage = { mission: "Dragonfly", year: 2028, note: "", source: { title: "", url: "" } };
    expect(isPlanned(heritage, new Date(2026, 10, 22))).toBe(true);
    expect(isPlanned({ ...heritage, year: 2011 }, new Date(2026, 10, 22))).toBe(false);
  });

  test("en inglés se traducen los textos del hangar", () => {
    const translator = createTranslator(english as unknown as Dictionary);
    const missing: string[] = [];
    const need = (text: string) => {
      if (text && translator.translate(text) === null) missing.push(text);
    };
    for (const robot of ROBOTS) {
      const info = hangarOf(robot.id)!;
      for (const item of Object.values(info.components)) {
        need(item.what);
        item.heritage.forEach((entry) => need(entry.note));
      }
      for (const mission of info.missions) {
        need(mission.summary);
        mission.milestones.forEach((milestone) => need(milestone.text));
      }
    }
    for (const text of [
      "Herencia de vuelo",
      "Componentes",
      "Desarmar",
      "Con la mano",
      "Proyectando el holograma…",
      "Lanzada el 30 de julio de 2020 · sigue en curso",
      "Del 26 de julio de 1971 al 7 de agosto de 1971",
      "3 misiones",
      "patinaje máx. 34 %",
      "Mano abierta: avanza",
      "La imagen se analiza en tu equipo: no se graba ni se envía.",
    ]) {
      need(text);
    }
    expect(missing).toEqual([]);
    expect(translator.translate("Del 26 de julio de 1971 al 7 de agosto de 1971")).toBe("From July 26, 1971 to August 7, 1971");
    expect(translator.translate("Lanzada el 30 de julio de 2020 · sigue en curso")).toBe("Launched July 30, 2020 · still ongoing");
  });
});

describe("bitácora de pruebas", () => {
  const memory = () => {
    const data = new Map<string, string>();
    return {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
      removeItem: (key: string) => void data.delete(key),
      data,
    };
  };
  const entry = (extra: Partial<NewLogEntry> = {}): NewLogEntry => ({
    at: "2026-11-22T10:00:00.000Z",
    robot: "viper",
    siteId: "pampa-de-la-joya",
    siteName: "Pampa de La Joya",
    soil: "Arena seca",
    outcome: "llego",
    reachedTarget: true,
    distanceM: 12.5,
    timeS: 90,
    energyWh: 4.2,
    maxSlopeDeg: 3.1,
    maxSlipPercent: 14,
    collisions: 0,
    stuckTimes: 0,
    mode: "manual",
    gestures: false,
    ...extra,
  });

  test("guarda por cuenta, de la más reciente a la más antigua", () => {
    const store = memory();
    saveLogEntry("Agencia@Ejemplo.org", entry({ at: "2026-11-20T10:00:00.000Z" }), null, store);
    saveLogEntry("agencia@ejemplo.org", entry({ at: "2026-11-22T10:00:00.000Z", robot: "lrv" }), null, store);
    saveLogEntry("otra@ejemplo.org", entry(), null, store);
    const log = readLog("agencia@ejemplo.org", store);
    expect(log.map((item) => item.robot)).toEqual(["lrv", "viper"]);
    expect(readLog("otra@ejemplo.org", store)).toHaveLength(1);
    expect(readLog("nadie@ejemplo.org", store)).toEqual([]);
    clearLog("agencia@ejemplo.org", store);
    expect(readLog("agencia@ejemplo.org", store)).toEqual([]);
  });

  test("seguir conduciendo y terminar otra vez sustituye la anotación, no la duplica", () => {
    const store = memory();
    const id = saveLogEntry("a@b.org", entry({ distanceM: 10 }), null, store)!;
    const same = saveLogEntry("a@b.org", entry({ distanceM: 25, at: "2026-11-22T10:05:00.000Z" }), id, store);
    expect(same).toBe(id);
    const log = readLog("a@b.org", store);
    expect(log).toHaveLength(1);
    expect(log[0].distanceM).toBe(25);
  });

  test("no falla sin almacenamiento, con datos rotos ni al llenarse", () => {
    expect(saveLogEntry("a@b.org", entry(), null, null)).toBeNull();
    expect(readLog("a@b.org", null)).toEqual([]);
    const store = memory();
    store.data.set("prometheus.bitacora.a@b.org", "{no es json");
    expect(readLog("a@b.org", store)).toEqual([]);
    store.data.set("prometheus.bitacora.a@b.org", JSON.stringify([{ id: "x" }, "texto", null]));
    expect(readLog("a@b.org", store)).toEqual([]);
    for (let k = 0; k < LOG_LIMIT + 5; k++) saveLogEntry("a@b.org", entry({ at: new Date(Date.UTC(2026, 0, 1, 0, k)).toISOString() }), null, store);
    expect(readLog("a@b.org", store)).toHaveLength(LOG_LIMIT);
    const full = { ...memory(), setItem: () => { throw new Error("lleno"); } };
    expect(saveLogEntry("a@b.org", entry(), null, full)).toBeNull();
  });

  test("resume las pruebas de un robot", () => {
    expect(summarize([])).toBeNull();
    const store = memory();
    saveLogEntry("a@b.org", entry({ distanceM: 10, maxSlipPercent: 20, maxSlopeDeg: 2, energyWh: 1.5 }), null, store);
    saveLogEntry("a@b.org", entry({ at: "2026-11-23T10:00:00.000Z", siteId: "cotopaxi", siteName: "Páramo del Cotopaxi", outcome: "atascado", distanceM: 30.4, maxSlipPercent: 100, maxSlopeDeg: 14.5, energyWh: 20, collisions: 2, gestures: true }), null, store);
    expect(summarize(readLog("a@b.org", store))).toEqual({
      runs: 2,
      places: 2,
      distanceM: 40.4,
      energyWh: 21.5,
      stuckRuns: 1,
      collisions: 2,
      worstSlip: { percent: 100, siteName: "Páramo del Cotopaxi" },
      steepest: { degrees: 14.5, siteName: "Páramo del Cotopaxi" },
      gestureRuns: 1,
    });
  });

  test("recuerda el robot que se pidió probar desde el hangar", () => {
    const store = memory();
    expect(preferredRobot(store)).toBeNull();
    setPreferredRobot("curiosity", store);
    expect(preferredRobot(store)).toBe("curiosity");
    expect(preferredRobot(null)).toBeNull();
  });
});

describe("dirección del hangar", () => {
  const user = (role: User["role"], status: User["status"]) => ({ id: "1", email: "a@b.org", role, status, createdAt: "", registeredAt: null, profile: null }) as User;

  test("es de toda cuenta activa y pide ingresar sin sesión", () => {
    expect(parseHash("#hangar")).toEqual({ screen: "hangar" });
    expect(hashOf({ screen: "hangar" })).toBe("#hangar");
    expect(guard({ screen: "hangar" }, null)).toEqual({ screen: "login" });
    expect(guard({ screen: "hangar" }, user("agencia", "activo"))).toEqual({ screen: "hangar" });
    expect(guard({ screen: "hangar" }, user("admin", "activo"))).toEqual({ screen: "hangar" });
    expect(guard({ screen: "hangar" }, user("agencia", "pendiente"))).toEqual({ screen: "registro" });
  });
});
