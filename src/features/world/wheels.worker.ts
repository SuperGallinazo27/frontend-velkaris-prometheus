// Cálculos de rueda y suelo fuera del hilo de la pantalla: cada uno son cientos de subidas de
// prueba y no deben trabar la interfaz. Atiende tres pedidos: la comparación de la pestaña
// «Ruedas», las tablas de patinaje del recorrido de prueba y el pronóstico de rodadura.
import { computeOutlooks, computeValidation, computeWheels, slipTables } from "../mission/wheelLab";
import type { Validation, WheelRequest } from "../mission/wheelLab";
import type { SoilId, VehicleId } from "../mission/wheelData";

export type LabMessage =
  | { id: number; kind: "comparar"; request: WheelRequest }
  | { id: number; kind: "tablas"; vehicle: VehicleId; earthSoil: SoilId }
  | { id: number; kind: "pronostico"; vehicle: VehicleId; soils: SoilId[]; slope: number };

let validation: Validation | null = null;

self.onmessage = (event: MessageEvent<LabMessage>) => {
  const message = event.data;
  if (message.kind === "tablas") {
    self.postMessage({ id: message.id, tables: slipTables(message.vehicle, message.earthSoil) });
    return;
  }
  if (message.kind === "pronostico") {
    self.postMessage({ id: message.id, outlooks: computeOutlooks(message.vehicle, message.soils, message.slope) });
    return;
  }
  // La comprobación no depende del lugar: se calcula una vez.
  validation ??= computeValidation();
  self.postMessage({ id: message.id, result: computeWheels(message.request), validation });
};
