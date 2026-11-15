/**
 * Cómo se llega a cada lugar: el aeropuerto, la carretera, el poblado y el hospital más cercanos,
 * según OpenStreetMap (`scripts/accesos/calcular.py` → `src/data/accesos.json`). Funciones puras.
 *
 * Las distancias son en línea recta desde el punto del lugar, no por carretera. OpenStreetMap lo
 * mantienen voluntarios: en zonas remotas puede faltar un camino o un puesto de salud, y que algo
 * no figure no prueba que no exista.
 */
import data from "../../data/accesos.json";

export interface Access {
  /** El aeropuerto con código IATA más cercano. */
  airport: { name: string | null; iata: string; distanceKm: number } | null;
  /** La carretera más cercana, de autopista a terciaria. */
  road: { kind: string; name: string | null; distanceKm: number } | null;
  /** El camino o la pista más cercanos, cuando hay uno más cerca que la carretera. */
  track: { kind: string; distanceKm: number } | null;
  town: { name: string | null; kind: string; distanceKm: number } | null;
  hospital: { name: string | null; distanceKm: number } | null;
}

const places = data.places as Record<string, Access | undefined>;

/** Accesos de un lugar de la lista; null si aún no se consultaron. */
export const accessOf = (placeId: string): Access | null => places[placeId] ?? null;

export const accessSource = data.source;
/** Hasta dónde se buscó cada cosa, en km: más lejos, se da por «ninguno cerca». */
export const accessLimits = data.limits;

const km = (value: number) => `${value.toLocaleString("es", { maximumFractionDigits: 1 })} km`;

export interface AccessRow {
  label: string;
  /** Lo que hay, o que no hay nada dentro del radio buscado. */
  text: string;
  found: boolean;
}

/** Las cuatro filas que se muestran, ya en palabras. */
export function accessRows(access: Access): AccessRow[] {
  const { airport, road, track, town, hospital } = access;
  const nearerTrack = track && (!road || track.distanceKm < road.distanceKm) ? track : null;
  return [
    {
      label: "Aeropuerto",
      found: Boolean(airport),
      text: airport
        ? `${airport.name ?? "Aeropuerto"} (${airport.iata}), a ${km(airport.distanceKm)}`
        : `Ninguno con vuelos a menos de ${accessLimits.airportKm} km en el mapa`,
    },
    {
      label: "Carretera",
      found: Boolean(road || track),
      text: road
        ? `${road.kind}${road.name ? ` ${road.name}` : ""}, a ${km(road.distanceKm)}` +
          (nearerTrack ? `; hay ${nearerTrack.kind === "pista" ? "una pista" : "un camino"} a ${km(nearerTrack.distanceKm)}` : "")
        : track
          ? `Sin carretera a menos de ${accessLimits.roadKm} km; ${track.kind === "pista" ? "una pista" : "un camino"} a ${km(track.distanceKm)}`
          : `Ninguna a menos de ${accessLimits.roadKm} km en el mapa`,
    },
    {
      label: "Poblado",
      found: Boolean(town),
      text: town
        ? `${town.name ?? "Sin nombre"} (${town.kind}), a ${km(town.distanceKm)}`
        : `Ninguno a menos de ${accessLimits.townKm} km en el mapa`,
    },
    {
      label: "Hospital",
      found: Boolean(hospital),
      text: hospital
        ? `${hospital.name ?? "Hospital sin nombre en el mapa"}, a ${km(hospital.distanceKm)}`
        : `Ninguno a menos de ${accessLimits.hospitalKm} km en el mapa`,
    },
  ];
}
