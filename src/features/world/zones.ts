/**
 * Localidades terrestres del mundo interactivo.
 *
 * La lista vive en `places.json`, que también lee el cálculo de terreno real
 * (`scripts/terreno/calcular.py`). Los nombres y la jerarquía (continente, país, provincia, zona)
 * son referencias geográficas reales y las coordenadas son aproximadas.
 *
 * Aquí cada localidad lleva los descriptores SINTÉTICOS de `demo`, que solo se usan en la
 * demostración de Marte. Los descriptores reales, para la Luna, están en `lunar.ts`.
 */
import places from "./places.json";

export interface Zone {
  id: string;
  continent: string;
  country: string;
  province: string;
  name: string;
  latitude: number;
  longitude: number;
  /** Relieve local en metros. */
  relief: number;
  /** Pendiente media en grados. */
  slope: number;
  /** Rugosidad en metros. */
  roughness: number;
}

export const zones: Zone[] = places.map(({ demo, ...place }) => ({ ...place, ...demo }));
