import { describe, expect, test } from "bun:test";
import { rankCandidates } from "../src/features/ranking/ranking";
import { candidates, regions } from "../src/data/demo";
describe("ranking", () => {
  test("identical terrain has zero distance", () =>
    expect(rankCandidates(regions[0], [regions[0]])[0].distance).toBe(0));
  test("known scaled differences", () =>
    expect(
      rankCandidates(regions[0], [
        { ...regions[0], relief: 1850, slope: 27, roughness: 155 },
      ])[0].distance,
    ).toBe(1));
  test("reference changes best candidate", () => {
    expect(rankCandidates(regions[0], candidates)[0].site.id).toBe("atacama");
    expect(rankCandidates(regions[1], candidates)[0].site.id).toBe("iceland");
    expect(rankCandidates(regions[2], candidates)[0].site.id).toBe("utah");
  });
  test("ties share rank and skip next position", () => {
    const rows = rankCandidates(regions[0], [
      { ...regions[0], id: "a" },
      { ...regions[0], id: "b" },
      { ...regions[0], id: "c", relief: 1850 },
    ]);
    expect(rows.map((r) => r.rank)).toEqual([1, 1, 3]);
  });
  test("empty candidates", () =>
    expect(rankCandidates(regions[0], [])).toEqual([]));
});
