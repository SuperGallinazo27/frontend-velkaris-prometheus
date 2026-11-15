import type { Terrain, RankedSite } from "../../types/analysis";

type Descriptors = Pick<Terrain, "relief" | "slope" | "roughness">;

/** Illustrative scaled absolute distance, consistent with the Python MVP. */
export function terrainDistance(a: Descriptors, b: Descriptors): number {
  return (
    (Math.abs(a.relief - b.relief) / 1000 +
      Math.abs(a.slope - b.slope) / 15 +
      Math.abs(a.roughness - b.roughness) / 100) /
    3
  );
}

export function rankCandidates(
  target: Terrain,
  sites: Terrain[],
): RankedSite[] {
  const rows = sites
    .map((site) => ({ site, distance: terrainDistance(site, target) }))
    .sort(
      (a, b) =>
        a.distance - b.distance || a.site.name.localeCompare(b.site.name),
    );
  return rows.map((row, index) => ({
    ...row,
    rank:
      rows.findIndex(
        (other) => Math.abs(other.distance - row.distance) < 1e-12,
      ) + 1 || index + 1,
  }));
}
