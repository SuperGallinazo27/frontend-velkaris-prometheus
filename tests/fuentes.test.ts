import { describe, expect, test } from "bun:test";
import data from "../src/data/fuentesAnalogos.json";
import places from "../src/features/world/places.json";
import { analogSourceOf } from "../src/features/world/analogSource";

describe("fuentes de los sitios análogos", () => {
  test("cada lugar de la lista tiene su entrada, con fuente o diciendo que no la hay", () => {
    for (const place of places) expect(analogSourceOf(place.id), place.id).not.toBeNull();
  });

  test("las fuentes tienen título, quién la publica y un enlace https", () => {
    for (const [id, entry] of Object.entries(data.places)) {
      if (!entry.source) continue;
      expect(entry.source.title.length, id).toBeGreaterThan(3);
      expect(entry.source.publisher.length, id).toBeGreaterThan(1);
      expect(entry.source.url, id).toStartWith("https://");
      expect(["Luna", "Marte", "Luna y Marte"], id).toContain(entry.analog_of as string);
      expect(entry.why_es.length, id).toBeGreaterThan(10);
    }
  });
});
