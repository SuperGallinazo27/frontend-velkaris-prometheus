import { useEffect, useState } from "react";
import type { SlipTable } from "../mission/drive";
import type { SoilId, VehicleId } from "../mission/wheelData";
import type { DriveOutlook, Validation, WheelResult } from "../mission/wheelLab";

export interface WheelLabData {
  result: WheelResult;
  validation: Validation;
}

export interface SlipTables {
  earth: SlipTable;
  moon: SlipTable;
}

let worker: Worker | null = null;
let nextId = 0;
const waiting = new Map<number, (data: unknown) => void>();

/** Un solo worker para toda la aplicación; se crea la primera vez que hace falta. */
function labWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL("./wheels.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<{ id: number }>) => {
      const deliver = waiting.get(event.data.id);
      waiting.delete(event.data.id);
      deliver?.(event.data);
    };
  }
  return worker;
}

/** Envía un pedido al worker; `deliver` recibe la respuesta. Devuelve cómo cancelar la espera. */
function ask(message: Record<string, unknown>, deliver: (data: unknown) => void): () => void {
  const id = ++nextId;
  waiting.set(id, deliver);
  labWorker().postMessage({ ...message, id });
  return () => {
    waiting.delete(id);
  };
}

/**
 * Calcula la comparación rueda-suelo en segundo plano. Mientras llega un cálculo nuevo, devuelve
 * el anterior con `pending: true`, para que la pantalla no salte.
 */
export function useWheelLab(vehicle: VehicleId, earthSoil: SoilId, moonSlope: number, earthSlope: number) {
  const key = `${vehicle}|${earthSoil}|${moonSlope}|${earthSlope}`;
  const [state, setState] = useState<{ key: string; data: WheelLabData } | null>(null);

  useEffect(
    () =>
      ask({ kind: "comparar", request: { vehicle, earthSoil, moonSlope, earthSlope } }, (data) => {
        const { result, validation } = data as WheelLabData;
        setState({ key, data: { result, validation } });
      }),
    [key, vehicle, earthSoil, moonSlope, earthSlope],
  );

  return { data: state?.data ?? null, pending: state?.key !== key };
}

/** Tablas de patinaje por pendiente (lugar y Luna) para el recorrido de prueba. */
export function useSlipTables(vehicle: VehicleId, earthSoil: SoilId) {
  const key = `${vehicle}|${earthSoil}`;
  const [state, setState] = useState<{ key: string; tables: SlipTables } | null>(null);

  useEffect(
    () =>
      ask({ kind: "tablas", vehicle, earthSoil }, (data) => {
        setState({ key, tables: (data as { tables: SlipTables }).tables });
      }),
    [key, vehicle, earthSoil],
  );

  return state?.key === key ? state.tables : null;
}

/**
 * El robot en cada suelo de la lista, en la pendiente típica del lugar: lo que necesita el
 * pronóstico de rodadura. Devuelve null mientras se calcula o si la lista está vacía.
 */
export function useDriveOutlooks(vehicle: VehicleId, soils: readonly SoilId[], slope: number) {
  // El orden no importa y los repetidos sobran: así la clave no cambia sin motivo.
  const list = [...new Set(soils)].sort().join(",");
  const key = `${vehicle}|${list}|${slope}`;
  const [state, setState] = useState<{ key: string; outlooks: DriveOutlook[] } | null>(null);

  useEffect(() => {
    if (!list) return;
    return ask({ kind: "pronostico", vehicle, soils: list.split(","), slope }, (data) => {
      setState({ key, outlooks: (data as { outlooks: DriveOutlook[] }).outlooks });
    });
  }, [key, vehicle, list, slope]);

  return state?.key === key ? state.outlooks : null;
}
