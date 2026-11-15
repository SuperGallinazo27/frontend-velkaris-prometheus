/**
 * Terreno REAL para comparar la Luna con la Tierra.
 *
 * `terrenoReal.json` lo genera `scripts/terreno/calcular.py` con la misma receta en ambos cuerpos:
 * ventanas de 3 km sobre una malla métrica y, por ventana, relieve, pendiente media y rugosidad.
 * Cada región lunar y cada lugar terrestre se resume con la mediana de sus ventanas.
 *
 * Tres zonas de la Luna, cada una con la mejor elevación disponible:
 * - Polo sur: las nueve regiones candidatas de Artemis III, a 30 m (LOLA, NASA GSFC PGDA).
 * - Polo norte: cráteres cercanos al polo, a 30 m (LOLA, NASA PDS).
 * - Zona central: accidentes de la cara visible, a 60 m (SLDEM2015, NASA PDS).
 *
 * La Tierra (Copernicus DEM, sin agua) se compara siempre a la misma resolución que la zona lunar.
 */
import data from "../../data/terrenoReal.json";
import type { Terrain } from "../../types/analysis";
import places from "./places.json";
import type { Zone } from "./zones";

/** Mediana y cuartiles de un descriptor entre las ventanas de un área. */
export interface Spread {
  median: number;
  q1: number;
  q3: number;
}

export type LunarZone = "sur" | "norte" | "central";

export interface LunarZoneInfo {
  id: LunarZone;
  name: string;
  /** Qué regiones tiene la zona. */
  detail: string;
  /** Cómo está orientado su mapa. */
  orientation: string;
  /** De dónde salen sus regiones y sus recuadros. */
  origin: string;
  /** Instrumento de la elevación, para citarlo en la ficha. */
  instrument: string;
  source: { name: string; url: string };
  /** Región con la que abre la zona. */
  first: string;
}

export const LUNAR_ZONES: LunarZoneInfo[] = [
  {
    id: "sur",
    name: "Polo sur",
    detail: "Regiones candidatas de Artemis III",
    orientation: "Arriba queda el lado visible desde la Tierra.",
    origin: "Regiones candidatas de Artemis III (NASA, 2024), ubicación aproximada.",
    instrument: "LOLA, 30 m",
    source: { name: "LOLA, NASA GSFC", url: data.sources.moon.url },
    first: "haworth",
  },
  {
    id: "norte",
    name: "Polo norte",
    detail: "Cráteres cercanos al polo",
    orientation: "Abajo queda el lado visible desde la Tierra.",
    origin: "Recuadros de 21 km centrados en cráteres con nombre (nomenclátor IAU).",
    instrument: "LOLA, 30 m",
    source: { name: "LOLA, NASA PDS", url: data.sources.moonNorth.url },
    first: "peary",
  },
  {
    id: "central",
    name: "Zona central",
    detail: "Ecuador y latitudes medias de la cara visible",
    orientation: "Cara visible, con el norte arriba. Los recuadros están ampliados: cada región mide 21 km.",
    origin: "Recuadros de 21 km centrados en accidentes con nombre (nomenclátor IAU).",
    instrument: "SLDEM2015, 60 m",
    source: { name: "SLDEM2015, NASA PDS", url: data.sources.moonCentral.url },
    first: "statio-tranquillitatis",
  },
];

export const zoneInfo = (zone: LunarZone) => LUNAR_ZONES.find((z) => z.id === zone)!;

export interface LunarRegion extends Terrain {
  /** Nombre descriptivo en español; `name` conserva la designación oficial. */
  nameEs: string;
  zone: LunarZone;
  /** Resolución de la elevación con la que se midió, en metros. */
  resolutionM: number;
  /** Recuadro en las unidades del mapa de su zona: metros en los polos, grados en la zona central. */
  box: { xMin: number; xMax: number; yMin: number; yMax: number };
  sizeKm: [number, number];
  /** Ventanas de 3 km que resumen la región. */
  windows: number;
  /** Fracción de píxeles con al menos una medición directa de LOLA; null si el producto no lo informa. */
  measured: number | null;
  spread: { relief: Spread; slope: Spread; roughness: Spread };
}

const SPANISH: Record<string, string> = {
  "peak-near-cabeus-b": "Pico junto a Cabeus B",
  haworth: "Zona de Haworth",
  "malapert-massif": "Macizo Malapert",
  "mons-mouton-plateau": "Meseta de Mons Mouton",
  "mons-mouton": "Mons Mouton",
  "nobile-rim-1": "Borde del cráter Nobile, zona 1",
  "nobile-rim-2": "Borde del cráter Nobile, zona 2",
  "de-gerlache-rim-2": "Borde del cráter de Gerlache, zona 2",
  "slater-plain": "Llanura de Slater",
  peary: "Cráter Peary",
  whipple: "Cráter Whipple",
  byrd: "Cráter Byrd",
  hermite: "Cráter Hermite",
  rozhdestvenskiy: "Cráter Rozhdestvenskiy",
  "statio-tranquillitatis": "Base de la Tranquilidad, donde alunizó el Apolo 11",
  "mons-hadley": "Monte Hadley, junto al alunizaje del Apolo 15",
  copernicus: "Cráter Copérnico",
  marius: "Cráter Marius, junto a las colinas de Marius",
  aristarchus: "Cráter Aristarco",
  "mons-pico": "Monte Pico, en el Mare Imbrium",
};

const CONTEXT: Record<LunarZone, string> = {
  sur: "Región candidata de Artemis III · polo sur lunar",
  norte: "Cráter del polo norte lunar",
  central: "Accidente de la cara visible de la Luna",
};

export const lunarRegions: LunarRegion[] = data.regions.flatMap((region) => {
  const { relief, slope, roughness } = region;
  if (!relief || !slope || !roughness) return [];
  const zone = region.zone as LunarZone;
  return [
    {
      id: region.id,
      name: region.name,
      nameEs: SPANISH[region.id] ?? region.name,
      context: CONTEXT[zone],
      world: "Luna" as const,
      zone,
      resolutionM: region.resolutionM,
      relief: relief.median,
      slope: slope.median,
      roughness: roughness.median,
      latitude: region.latitude,
      longitude: region.longitude,
      box: region.box,
      sizeKm: [region.sizeKm[0], region.sizeKm[1]] as [number, number],
      windows: region.windows,
      measured: region.measured,
      spread: { relief, slope, roughness },
    },
  ];
});

export const regionsOf = (zone: LunarZone) => lunarRegions.filter((region) => region.zone === zone);

/** Recorte del mapa de una zona, en las mismas unidades que los recuadros de sus regiones. */
export interface LunarMapInfo {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  width: number;
  height: number;
  /** Posición del polo, si el mapa lo contiene. */
  pole: { x: number; y: number } | null;
  /** Barra de escala: cuántos kilómetros representa y cuánto mide en unidades del mapa. */
  scale: { km: number; units: number };
}

export const lunarMaps: Record<LunarZone, LunarMapInfo> = data.maps;

/** Cómo se midió un lugar terrestre. */
export interface Survey {
  dem: string;
  /** Ventanas válidas a 30 m y a 60 m. */
  windows: number;
  coarseWindows: number;
  windowsTotal: number;
  /** Fracción del área que el modelo marca como agua y queda fuera del cálculo. */
  water: number;
  /** Altitud típica del área, en metros; null si no se pudo medir. */
  elevation: number | null;
}

const surveys = new Map<string, Survey>(
  data.sites.map((site) => [
    site.id,
    {
      dem: site.dem,
      windows: site.windows,
      coarseWindows: site.coarse.windows,
      windowsTotal: site.windowsTotal,
      water: site.water,
      elevation: site.elevation,
    },
  ]),
);

export const surveyOf = (zoneId: string): Survey | undefined => surveys.get(zoneId);

const sitesById = new Map(data.sites.map((site) => [site.id, site]));

/** Lugares medidos a una resolución. Un lugar sin datos no entra: nunca se rellena con ceros. */
function measuredAt(resolutionM: number): Zone[] {
  return places.flatMap(({ demo: _demo, ...place }) => {
    const site = sitesById.get(place.id);
    const values = resolutionM === 30 ? site : site?.coarse;
    if (!values?.relief || !values.slope || !values.roughness) return [];
    return [{ ...place, relief: values.relief.median, slope: values.slope.median, roughness: values.roughness.median }];
  });
}

/** Lugares con terreno medido a 30 m (para los polos) y a 60 m (para la zona central). */
export const measuredZones: Zone[] = measuredAt(30);
export const coarseZones: Zone[] = measuredAt(60);

/** Los lugares a comparar con una región lunar: los medidos a su misma resolución. */
export const zonesFor = (region: LunarRegion): Zone[] => (region.resolutionM === 30 ? measuredZones : coarseZones);

/** Lugares de la lista que quedaron sin datos, con el motivo. */
export const unmeasuredZones: { name: string; reason: string }[] = places.flatMap((place) => {
  if (measuredZones.some((zone) => zone.id === place.id)) return [];
  const site = sitesById.get(place.id);
  const reason = !site
    ? "sin calcular"
    : site.water > 0.5
      ? "el modelo de elevación lo marca como agua"
      : "sin cobertura suficiente";
  return [{ name: place.name, reason }];
});

export const terrainMethod = data.method;
export const terrainSources = data.sources;
export const terrainDate = data.generatedAt;

export const DEFAULT_REGION = "haworth";
