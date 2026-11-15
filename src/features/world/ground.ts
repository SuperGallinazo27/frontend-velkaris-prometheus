/**
 * Temperatura del suelo, aquí y en la Luna. Funciones puras sobre dos tablas ya calculadas:
 *
 * - `temperaturaSuelo.json` (`scripts/temperatura/calcular.py`): MODIS a 1 km, media de día y de
 *   noche de cada trimestre en el recuadro de 18 km de cada lugar.
 * - `temperaturaLuna.json` (`scripts/luna/temperatura.py`): radiómetro Diviner de LRO, la
 *   temperatura más alta y más baja del ciclo día-noche en cada región lunar.
 *
 * Es la temperatura de la superficie, no la del aire: de día, el suelo desnudo se calienta mucho
 * más que el aire que se mide a 2 m.
 */
import moon from "../../data/temperaturaLuna.json";
import earth from "../../data/temperaturaSuelo.json";

export const QUARTER_NAMES = ["ene–mar", "abr–jun", "jul–sep", "oct–dic"] as const;

const KELVIN = 273.15;

interface EarthSite {
  day: (number | null)[];
  night: (number | null)[];
  coverage: (number | null)[];
}

export interface QuarterGround {
  /** 0 = enero a marzo. */
  index: number;
  /** °C; null si el satélite no tiene dato suficiente en ese trimestre. */
  day: number | null;
  night: number | null;
  /** Cuánto baja de día a noche, en °C. */
  swing: number | null;
}

export interface Ground {
  quarters: QuarterGround[];
  /** La temperatura más alta de día y la más baja de noche del año, con su trimestre. */
  hottest: { value: number; quarter: number } | null;
  coldest: { value: number; quarter: number } | null;
  /** El mayor salto entre el día y la noche de un mismo trimestre. */
  widestSwing: number | null;
}

const sites = earth.sites as Record<string, EarthSite | null>;

/** Temperatura del suelo de un lugar de la lista; null si no tiene dato. */
export function groundOf(zoneId: string): Ground | null {
  const site = sites[zoneId];
  if (!site) return null;
  const quarters = site.day.map((day, index) => {
    const night = site.night[index];
    return { index, day, night, swing: day !== null && night !== null ? Math.round((day - night) * 10) / 10 : null };
  });
  const best = (values: (number | null)[], better: (a: number, b: number) => boolean) => {
    let hit: { value: number; quarter: number } | null = null;
    values.forEach((value, quarter) => {
      if (value !== null && (!hit || better(value, hit.value))) hit = { value, quarter };
    });
    return hit as { value: number; quarter: number } | null;
  };
  const swings = quarters.map((q) => q.swing).filter((v): v is number => v !== null);
  return {
    quarters,
    hottest: best(site.day, (a, b) => a > b),
    coldest: best(site.night, (a, b) => a < b),
    widestSwing: swings.length ? Math.max(...swings) : null,
  };
}

export interface MoonGround {
  /** °C: valor típico (mediana) de las celdas de la región. */
  max: number;
  min: number;
  swing: number;
  /** Celdas de 0,5° que entran en la región. */
  cells: number;
}

const regions = moon.regions as Record<string, { maxK: number; minK: number; cells: number; hours: number } | null>;

/** Temperatura del suelo de una región lunar; null si Diviner no la cubre lo suficiente. */
export function moonGroundOf(regionId: string): MoonGround | null {
  const region = regions[regionId];
  if (!region) return null;
  const max = Math.round(region.maxK - KELVIN);
  const min = Math.round(region.minK - KELVIN);
  return { max, min, swing: max - min, cells: region.cells };
}

/** Trimestre (0 a 3) al que pertenece un mes (0 = enero). */
export const quarterOfMonth = (month: number) => Math.floor(month / 3);

export const groundSource = earth.source;
export const moonGroundSource = moon.source;
