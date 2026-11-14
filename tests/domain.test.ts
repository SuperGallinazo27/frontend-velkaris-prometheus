import { describe, expect, test } from "bun:test";
import { rankCandidates } from "../src/features/ranking/ranking";
import { estimateBudget } from "../src/features/economy/budget";
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
describe("budget", () => {
  test("baseline includes contingency on subtotal", () =>
    expect(estimateBudget(7, 6, 120, 1800, 15)).toEqual({
      fieldwork: 5040,
      logistics: 1800,
      reserve: 1026,
      total: 7866,
    }));
  test("zero optional costs", () =>
    expect(estimateBudget(1, 1, 0, 0, 0).total).toBe(0));
  test("rejects invalid assumptions", () => {
    expect(() => estimateBudget(0, 6, 120, 1800, 15)).toThrow();
    expect(() => estimateBudget(7, 6, NaN, 1800, 15)).toThrow();
  });
});
