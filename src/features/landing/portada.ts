/**
 * Los datos de la portada. Con la Luna son reales: tres regiones medidas, una por zona, y los tres
 * lugares de la Tierra con más coincidencia de terreno con cada una, con el mismo cálculo que el
 * mundo interactivo. Marte sigue siendo una demostración con valores sintéticos.
 */
import { candidates as demoCandidates, regions as demoRegions } from "../../data/demo";
import type { RankedSite, Terrain } from "../../types/analysis";
import { rankCandidates } from "../ranking/ranking";
import { matchZones } from "../world/hierarchy";
import { lunarRegions, zonesFor } from "../world/lunar";

/** Las regiones lunares que se ofrecen en la portada, con lo que las hace conocidas. */
const MOON_PICKS: { id: string; context: string }[] = [
  { id: "haworth", context: "Polo sur · una de las nueve regiones candidatas de Artemis III" },
  { id: "statio-tranquillitatis", context: "Zona central · donde alunizó el Apolo 11" },
  { id: "peary", context: "Polo norte · fondo del cráter Peary" },
];

/** Cuántos lugares se muestran en la portada por región. */
export const TOP_PLACES = 3;

interface MoonScenario {
  region: Terrain;
  /** Los lugares de la Tierra con más coincidencia, del primero al tercero. */
  ranking: RankedSite[];
  /** Lugares de la lista que se compararon con esta región. */
  compared: number;
}

const scenarios: MoonScenario[] = MOON_PICKS.flatMap(({ id, context }) => {
  const lunar = lunarRegions.find((region) => region.id === id);
  if (!lunar) return [];
  const matches = matchZones(zonesFor(lunar), [lunar]).sort(
    (a, b) => a.distance - b.distance || a.zone.name.localeCompare(b.zone.name),
  );
  return [
    {
      region: { ...lunar, context },
      compared: matches.length,
      ranking: matches.slice(0, TOP_PLACES).map((match, index) => ({
        rank: index + 1,
        distance: match.distance,
        site: {
          id: match.zone.id,
          name: match.zone.name,
          context: `${match.zone.province}, ${match.zone.country}`,
          world: "Tierra" as const,
          relief: match.zone.relief,
          slope: match.zone.slope,
          roughness: match.zone.roughness,
          latitude: match.zone.latitude,
          longitude: match.zone.longitude,
        },
      })),
    },
  ];
});

export const moonRegions: Terrain[] = scenarios.map((scenario) => scenario.region);
export const marsRegions: Terrain[] = demoRegions.filter((region) => region.world === "Marte");

/** Con qué se ordenan los lugares: mediciones para la Luna, valores sintéticos para Marte. */
export function rankingFor(region: Terrain): { rows: RankedSite[]; real: boolean; compared: number } {
  const scenario = scenarios.find((item) => item.region.id === region.id);
  if (scenario) return { rows: scenario.ranking, real: true, compared: scenario.compared };
  return { rows: rankCandidates(region, demoCandidates), real: false, compared: demoCandidates.length };
}

/** Todo lo que la escena 3D puede tener que señalar: las regiones y cualquier lugar que salga en un ranking. */
export const sceneRegions: Terrain[] = [...moonRegions, ...marsRegions];
export const sceneCandidates: Terrain[] = [
  ...new Map(scenarios.flatMap((scenario) => scenario.ranking.map((row) => [row.site.id, row.site] as const))).values(),
  ...demoCandidates,
];
