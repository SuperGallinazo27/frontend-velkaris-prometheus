import type { Terrain, RankedSite } from "../../types/analysis";
/** Illustrative scaled absolute distance, consistent with the Python MVP. */
export function rankCandidates(
  target: Terrain,
  sites: Terrain[],
): RankedSite[] {
  const rows = sites
    .map((site) => ({
      site,
      distance:
        (Math.abs(site.relief - target.relief) / 1000 +
          Math.abs(site.slope - target.slope) / 15 +
          Math.abs(site.roughness - target.roughness) / 100) /
        3,
    }))
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
