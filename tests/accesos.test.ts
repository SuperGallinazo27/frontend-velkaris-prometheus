import { describe, expect, test } from "bun:test";
import data from "../src/data/accesos.json";
import { accessLimits, accessOf, accessRows } from "../src/features/world/access";
import type { Access } from "../src/features/world/access";
import places from "../src/features/world/places.json";

const full: Access = {
  airport: { name: "Aeropuerto Internacional Alfredo Rodríguez Ballón", iata: "AQP", distanceKm: 53 },
  road: { kind: "carretera secundaria", name: "AR-798", distanceKm: 0.9 },
  track: { kind: "camino", distanceKm: 0.3 },
  town: { name: "San Camilo", kind: "aldea", distanceKm: 1 },
  hospital: { name: null, distanceKm: 38 },
};

describe("cómo se llega", () => {
  test("cada dato se cuenta con su distancia, en español", () => {
    const rows = accessRows(full);
    expect(rows.map((row) => row.label)).toEqual(["Aeropuerto", "Carretera", "Poblado", "Hospital"]);
    expect(rows[0].text).toBe("Aeropuerto Internacional Alfredo Rodríguez Ballón (AQP), a 53 km");
    // Un camino más cercano que la carretera también se menciona.
    expect(rows[1].text).toBe("carretera secundaria AR-798, a 0,9 km; hay un camino a 0,3 km");
    expect(rows[2].text).toBe("San Camilo (aldea), a 1 km");
    expect(rows[3].text).toBe("Hospital sin nombre en el mapa, a 38 km");
    expect(rows.every((row) => row.found)).toBe(true);
  });

  test("lo que no está en el mapa se dice, con el radio que se buscó", () => {
    const rows = accessRows({ airport: null, road: null, track: { kind: "pista", distanceKm: 4.7 }, town: null, hospital: null });
    expect(rows[0]).toEqual({ label: "Aeropuerto", found: false, text: `Ninguno con vuelos a menos de ${accessLimits.airportKm} km en el mapa` });
    expect(rows[1].text).toBe(`Sin carretera a menos de ${accessLimits.roadKm} km; una pista a 4,7 km`);
    expect(rows[1].found).toBe(true);
    expect(rows[2].found).toBe(false);
    expect(rows[3].text).toContain(`${accessLimits.hospitalKm} km`);
    const nothing = accessRows({ airport: null, road: null, track: null, town: null, hospital: null });
    expect(nothing.every((row) => !row.found)).toBe(true);
  });

  test("un camino más lejano que la carretera no se menciona", () => {
    const rows = accessRows({ ...full, track: { kind: "camino", distanceKm: 5 } });
    expect(rows[1].text).toBe("carretera secundaria AR-798, a 0,9 km");
  });

  test("los datos guardados son de lugares de la lista y tienen sentido", () => {
    const entries = Object.entries(data.places as Record<string, Access>);
    expect(entries.length).toBeGreaterThan(0);
    for (const [id, access] of entries) {
      expect(places.some((place) => place.id === id)).toBe(true);
      if (access.airport) {
        expect(access.airport.iata).toMatch(/^[A-Z]{3}$/);
        expect(access.airport.distanceKm).toBeLessThanOrEqual(accessLimits.airportKm);
      }
      for (const item of [access.airport, access.road, access.track, access.town, access.hospital]) {
        if (item) expect(item.distanceKm).toBeGreaterThanOrEqual(0);
      }
      expect(accessOf(id)).toBe(access);
    }
    expect(accessOf("no-existe")).toBeNull();
    expect(data.source.license).toBe("ODbL");
  });
});
