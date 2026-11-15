import { useSyncExternalStore } from "react";
import { turnos } from "../../services/turnos";
import type { PlaceStatus } from "../../services/turnosRules";

/**
 * Estado de todos los lugares para reservar (área protegida, cerrado, ocupado hoy), compartido por
 * las pantallas que lo muestran. Se pide una vez, se vuelve a pedir cuando cambia algo en el portal
 * (un turno, una decisión del administrador) y se refresca si ya tiene más de un minuto.
 */
const STALE_MS = 60_000;

let byId: ReadonlyMap<string, PlaceStatus> = new Map();
let loading = false;
let loadedAt = 0;
let request = 0;
const listeners = new Set<() => void>();

function load() {
  const id = ++request;
  loading = true;
  turnos
    .places()
    .then((list) => {
      if (id !== request) return;
      byId = new Map(list.map((place) => [place.id, place]));
      loadedAt = Date.now();
      listeners.forEach((listener) => listener());
    })
    // Sin sesión o sin servidor no hay estados: las pantallas siguen sin insignias.
    .catch(() => {})
    .finally(() => {
      if (id === request) loading = false;
    });
}

turnos.subscribe(load);

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!loading && Date.now() - loadedAt > STALE_MS) load();
  return () => listeners.delete(listener);
}

/** Mapa de id de lugar → estado. Vacío mientras se carga o si no se pudo consultar. */
export function usePlaceStatuses(): ReadonlyMap<string, PlaceStatus> {
  return useSyncExternalStore(subscribe, () => byId);
}
