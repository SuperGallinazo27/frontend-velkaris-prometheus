import { describe, expect, test } from "bun:test";
import english from "../src/i18n/en.json";
import { createTranslator, translateDates } from "../src/i18n/translator";
import type { Dictionary } from "../src/i18n/translator";

const t = createTranslator({
  exact: {
    "Iniciar sesión": "Sign in",
    Cubierto: "Overcast",
    alta: "high",
    "Llueve mucho más de lo normal.": "It is raining much more than usual.",
    "Pampa de La Joya": "Pampa of La Joya (no debería usarse)",
  },
  templates: [
    ["Se atascó a los {0} m, en una pendiente de {1}°", "Got stuck after {0} m, on a {1}° slope"],
    ["Similitud {0} · {1} % de coincidencia", "{0} similarity · {1} % match"],
    ["{0} de {1}", "{0} of {1}"],
    ["Sin texto fijo suficiente {0}", "{0} {1}"],
  ],
});

describe("traductor de la interfaz", () => {
  test("textos fijos, conservando los espacios de los bordes", () => {
    expect(t.translate("Iniciar sesión")).toBe("Sign in");
    expect(t.translate("  Iniciar   sesión ")).toBe("  Sign in ");
    expect(t.translate("Texto que no está")).toBeNull();
    expect(t.translate("12,5 m")).toBeNull();
  });

  test("plantillas ya rellenas, con los valores traducidos si se puede", () => {
    expect(t.translate("Se atascó a los 12 m, en una pendiente de 3,5°")).toBe("Got stuck after 12 m, on a 3,5° slope");
    expect(t.translate("Similitud alta · 96 % de coincidencia")).toBe("High similarity · 96 % match");
  });

  test("no usa plantillas casi sin texto fijo ni con huecos que no cuadran", () => {
    // «{0} de {1}» convertiría nombres propios: «Pampa de La Joya» se queda igual.
    expect(t.translate("Valle de Arizona")).toBeNull();
    expect(t.translate("Sin texto fijo suficiente x")).toBeNull();
  });

  test("listas con « · » y varias frases, trozo por trozo", () => {
    expect(t.translate("Cubierto · -5 °C")).toBe("Overcast · -5 °C");
    expect(t.translate("Llueve mucho más de lo normal. Otra frase sin traducir.")).toBe(
      "It is raining much more than usual. Otra frase sin traducir.",
    );
  });

  test("fechas en español", () => {
    expect(translateDates("desde el 16 de agosto de 2027")).toBe("desde el August 16, 2027");
    expect(translateDates("agosto de 2026")).toBe("August 2026");
    expect(translateDates("hasta el 3 de noviembre")).toBe("hasta el November 3");
    expect(t.translate("16 de agosto de 2027")).toBe("August 16, 2027");
  });
});

describe("diccionario de inglés", () => {
  const dictionary = english as Dictionary;

  test("tiene textos y plantillas, sin traducciones vacías", () => {
    expect(Object.keys(dictionary.exact).length).toBeGreaterThan(1000);
    expect(dictionary.templates.length).toBeGreaterThan(50);
    for (const [es, en] of Object.entries(dictionary.exact)) {
      expect(en.trim().length, es).toBeGreaterThan(0);
    }
  });

  test("cada plantilla usa en inglés los mismos huecos que en español", () => {
    const slots = (s: string) => [...s.matchAll(/\{(\d+)\}/g)].map((m) => m[1]).sort().join(",");
    for (const [es, en] of dictionary.templates) expect(slots(en), es).toBe(slots(es));
  });

  test("las pantallas principales están traducidas", () => {
    const real = createTranslator(dictionary);
    for (const text of ["Inicia sesión", "Cerrar sesión", "Mis turnos", "Prueba del robot", "Copiloto IA", "Volver a la portada"]) {
      expect(real.translate(text), text).not.toBeNull();
    }
  });
});
