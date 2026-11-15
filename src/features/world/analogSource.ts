/**
 * Por qué cada lugar está en la lista: la fuente publicada (NASA, ESA, artículos científicos) que lo
 * documenta como sitio análogo de la Luna o de Marte. Cada enlace se abrió y se comprobó que nombra
 * el lugar como análogo. Si no se encontró una fuente, el lugar lo dice: no se inventa una cita.
 *
 * La similitud con la región lunar NO sale de aquí: la calcula PROMETHEUS con el relieve real.
 */
import data from "../../data/fuentesAnalogos.json";

export type AnalogOf = "Luna" | "Marte" | "Luna y Marte";

export interface AnalogSource {
  analogOf: AnalogOf | null;
  why: string;
  source: { title: string; publisher: string; year: number | null; url: string } | null;
  note: string | null;
}

interface Raw {
  analog_of: AnalogOf | null;
  why_es: string;
  source: { title: string; publisher: string; year: number | null; url: string } | null;
  note?: string | null;
}

const places = data.places as Record<string, Raw>;

export function analogSourceOf(placeId: string): AnalogSource | null {
  const raw = places[placeId];
  if (!raw) return null;
  return { analogOf: raw.analog_of, why: raw.why_es, source: raw.source, note: raw.note ?? null };
}

export const analogSourcesChecked: string = data.checked;
