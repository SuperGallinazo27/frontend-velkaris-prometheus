/**
 * Cómo está el suelo de un lugar hoy y en los próximos días, listo para usar.
 *
 * ── Para otras partes de la aplicación (simulador, copiloto) ──
 *
 *   const ground = useGroundNow(placeId, latitude, longitude);
 *   ground.status                       // "cargando" | "error" | "listo"
 *   ground.summary?.state               // "seco" | "humedo" | "embarrado" | "helado" | "nevado"
 *   ground.summary?.stateName           // «Embarrado»
 *   ground.summary?.wet                 // true si no está seco: para oscurecer el suelo del 3D
 *   ground.summary?.moisture            // m³ de agua por m³ de suelo (primeros 9 cm)
 *   ground.summary?.saturationPercent   // 0 a 100
 *   ground.summary?.rain72hMm           // mm en las últimas 72 horas
 *   ground.summary?.soilId              // suelo del cálculo de ruedas para hoy (`SoilId`)
 *   ground.summary?.soilName            // «Franco arenoso, 32 % de humedad»
 *   ground.summary?.reason              // por qué, en una frase
 *
 * Fuera de React: `fetchGroundSummary(placeId, latitude, longitude)` devuelve la misma `summary`.
 *
 * Todo sale de `services/groundForecast.ts` (Open-Meteo, un modelo: no es una medición en el
 * lugar) y de las reglas de `soilState.ts`. La consulta se reutiliza media hora.
 */
import { useEffect, useState } from "react";
import type { SoilFamily, SoilId } from "../mission/wheelData";
import { fetchGroundForecast } from "../../services/groundForecast";
import type { GroundDay, GroundForecast } from "../../services/groundForecast";
import { GROUND_STATES, familyOf, groundReading, textureOf, waterLimits, wheelSoil } from "./soilState";
import type { GroundReading, GroundStateId, WaterLimits, WheelSoil } from "./soilState";

export interface GroundDayState {
  day: GroundDay;
  reading: GroundReading;
  soil: WheelSoil;
}

export interface GroundSummary {
  state: GroundStateId;
  stateName: string;
  /** true si el suelo no está seco (húmedo, embarrado, helado o con nieve). */
  wet: boolean;
  moisture: number | null;
  saturationPercent: number | null;
  rain72hMm: number;
  rain7dMm: number;
  soilId: SoilId;
  soilName: string;
  reason: string;
}

export interface GroundResult {
  /** Cuánta agua aguanta este suelo, según su textura. */
  limits: WaterLimits;
  /** El estado de ahora y el suelo de ruedas que le toca. */
  reading: GroundReading;
  soil: WheelSoil;
  /** Hoy y los días siguientes. */
  days: GroundDayState[];
  forecast: GroundForecast;
  summary: GroundSummary;
}

/**
 * Convierte la consulta en estados. `family` es la clase de suelo con la que se calcula la rueda;
 * por defecto, la que sugiere la textura del lugar.
 */
export function groundResult(forecast: GroundForecast, placeId: string, family: SoilFamily = familyOf(placeId)): GroundResult {
  const texture = textureOf(placeId);
  const limits = waterLimits(texture);
  const sand = texture?.sand ?? null;
  const density = texture?.bulkDensity ?? null;

  const reading = groundReading(
    {
      moisture: forecast.now.moisture,
      rain3dMm: forecast.rain72hMm,
      rain7dMm: forecast.rain7dMm,
      soilTemp: forecast.now.soilTemp,
      snowDepth: forecast.now.snowDepth,
    },
    limits,
    sand,
  );
  const soil = wheelSoil(family, reading.state, reading.moisture, density);

  const days = forecast.days.map((day) => {
    const dayReading = groundReading(
      // Un día cuenta como helado solo si el suelo no pasa de 0 °C en todo el día.
      {
        moisture: day.moisture,
        rain3dMm: day.rain3dMm,
        rain7dMm: day.rain7dMm,
        soilTemp: day.soilTempMax,
        snowDepth: day.snowDepthMax,
      },
      limits,
      sand,
    );
    return { day, reading: dayReading, soil: wheelSoil(family, dayReading.state, dayReading.moisture, density) };
  });

  return {
    limits,
    reading,
    soil,
    days,
    forecast,
    summary: {
      state: reading.state,
      stateName: GROUND_STATES[reading.state].name,
      wet: reading.state !== "seco",
      moisture: reading.moisture,
      saturationPercent: reading.saturationShare === null ? null : Math.round(reading.saturationShare * 100),
      rain72hMm: forecast.rain72hMm,
      rain7dMm: forecast.rain7dMm,
      soilId: soil.preset.id,
      soilName: soil.preset.name,
      reason: reading.reason,
    },
  };
}

/** El resumen de hoy, para usarlo fuera de React. Lanza un error si el servicio no responde. */
export async function fetchGroundSummary(placeId: string, latitude: number, longitude: number): Promise<GroundSummary> {
  return groundResult(await fetchGroundForecast(latitude, longitude), placeId).summary;
}

export type GroundNow =
  | { status: "cargando"; result: null; summary: null; retry: () => void }
  | { status: "error"; result: null; summary: null; retry: () => void }
  | { status: "listo"; result: GroundResult; summary: GroundSummary; retry: () => void };

/**
 * Estado del suelo del lugar. Cambiar de lugar vuelve a «cargando»; `retry` repite la consulta.
 * `family` solo hace falta si la rueda se calcula con otra clase de suelo que la sugerida.
 */
export function useGroundNow(placeId: string, latitude: number, longitude: number, family?: SoilFamily): GroundNow {
  const key = `${placeId}|${latitude}|${longitude}`;
  const [state, setState] = useState<{ key: string; forecast: GroundForecast | "error" } | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetchGroundForecast(latitude, longitude)
      .then((forecast) => !cancelled && setState({ key, forecast }))
      .catch(() => !cancelled && setState({ key, forecast: "error" }));
    return () => {
      cancelled = true;
    };
  }, [key, latitude, longitude, attempt]);

  const retry = () => {
    setState(null);
    setAttempt((n) => n + 1);
  };
  if (state?.key !== key) return { status: "cargando", result: null, summary: null, retry };
  if (state.forecast === "error") return { status: "error", result: null, summary: null, retry };
  const result = groundResult(state.forecast, placeId, family);
  return { status: "listo", result, summary: result.summary, retry };
}
