import { describe, expect, test } from "bun:test";
import { COUNTRIES, displayCountry, matchCountry } from "../src/services/countries";

describe("lista de países", () => {
  test("tiene los 249 códigos ISO 3166-1, sin repetir códigos ni nombres", () => {
    expect(COUNTRIES).toHaveLength(249);
    expect(new Set(COUNTRIES.map((c) => c.code)).size).toBe(249);
    expect(new Set(COUNTRIES.map((c) => c.name)).size).toBe(249);
    expect(COUNTRIES.every((c) => /^[A-Z]{2}$/.test(c.code))).toBe(true);
  });

  test("está en orden alfabético español", () => {
    const collator = new Intl.Collator("es");
    const names = COUNTRIES.map((c) => c.name);
    expect([...names].sort(collator.compare)).toEqual(names);
  });

  test("usa los nombres en español", () => {
    const byCode = Object.fromEntries(COUNTRIES.map((c) => [c.code, c.name]));
    expect(byCode.EC).toBe("Ecuador");
    expect(byCode.US).toBe("Estados Unidos");
    expect(byCode.PE).toBe("Perú");
    expect(byCode.CI).toBe("Costa de Marfil");
  });
});

describe("país escrito a mano", () => {
  test("se reconoce sin importar mayúsculas, tildes ni espacios", () => {
    expect(matchCountry("ecuador")).toBe("Ecuador");
    expect(matchCountry("  PERU ")).toBe("Perú");
    expect(matchCountry("republica   dominicana")).toBe("República Dominicana");
  });

  test("lo que no es un país de la lista no se inventa", () => {
    expect(matchCountry("Marte")).toBeNull();
    expect(matchCountry("")).toBeNull();
    expect(displayCountry(" Marte ")).toBe("Marte");
    expect(displayCountry("mexico")).toBe("México");
  });
});
