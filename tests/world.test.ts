import { describe, expect, test } from "bun:test";
import { regions } from "../src/data/demo";
import {
  BANDS,
  anchor,
  bandOf,
  centroid,
  childrenOf,
  matchZones,
  nodeOf,
  nodesAt,
  pathOf,
  trimPath,
} from "../src/features/world/hierarchy";
import {
  DEFAULT_REGION,
  LUNAR_ZONES,
  coarseZones,
  lunarMaps,
  lunarRegions,
  measuredZones,
  regionsOf,
  surveyOf,
  unmeasuredZones,
  zonesFor,
} from "../src/features/world/lunar";
import places from "../src/features/world/places.json";
import terrain from "../src/data/terrenoReal.json";
import { decodeArcs, shapesOf } from "../src/features/world/topology";
import type { Topology } from "../src/features/world/topology";
import { zones } from "../src/features/world/zones";

const moon = regions.filter((r) => r.world === "Luna");
const mars = regions.filter((r) => r.world === "Marte");

describe("parecido de las localidades", () => {
  test("los límites separan cerca, mediano y lejos", () => {
    expect(bandOf(0)).toBe("alta");
    expect(bandOf(0.15)).toBe("alta");
    expect(bandOf(0.16)).toBe("media");
    expect(bandOf(0.4)).toBe("media");
    expect(bandOf(0.41)).toBe("baja");
  });

  test("cada localidad se empareja con su escenario más parecido", () => {
    const [match] = matchZones([{ ...zones[0], relief: 1700, slope: 20, roughness: 85 }], moon);
    expect(match.scenario.id).toBe("tycho");
    expect(match.distance).toBe(0);
    expect(match.band).toBe("alta");
    expect(matchZones(zones, [])).toEqual([]);
  });

  test("los datos de ejemplo cubren los tres niveles con los escenarios de demostración", () => {
    for (const scenarios of [moon, mars]) {
      const matches = matchZones(zones, scenarios);
      for (const band of BANDS) {
        expect(matches.filter((m) => m.band === band.id).length).toBeGreaterThanOrEqual(4);
      }
    }
  });

  test("no hay dos localidades con la misma ruta ni coordenadas fuera de rango", () => {
    const paths = zones.map((z) => pathOf(z).join(" / "));
    expect(new Set(paths).size).toBe(zones.length);
    for (const z of zones) {
      expect(Math.abs(z.latitude)).toBeLessThanOrEqual(90);
      expect(Math.abs(z.longitude)).toBeLessThanOrEqual(180);
    }
  });
});

describe("desglose continente → país → provincia → zona", () => {
  const matches = matchZones(zones, moon);

  test("cada nivel reparte todas las localidades", () => {
    for (let level = 0; level < 4; level++) {
      const total = nodesAt(matches, level).reduce((sum, node) => sum + node.count, 0);
      expect(total).toBe(zones.length);
    }
    expect(nodesAt(matches, 3)).toHaveLength(zones.length);
  });

  test("se puede bajar de un continente hasta una zona", () => {
    const continents = childrenOf(matches, []);
    expect(continents.map((n) => n.name)).toContain("América del Sur");
    const countries = childrenOf(matches, ["América del Sur"]);
    expect(countries.map((n) => n.name)).toEqual(["Chile", "Argentina", "Bolivia", "Perú", "Ecuador"]);
    const provinces = childrenOf(matches, ["América del Sur", "Chile"]);
    expect(provinces.map((n) => [n.name, n.count])).toEqual([
      ["Antofagasta", 3],
      ["Atacama", 1],
    ]);
    const places = childrenOf(matches, ["América del Sur", "Chile", "Antofagasta"]);
    expect(places.map((n) => n.name)).toEqual(["Valle de la Luna", "Salar de Atacama", "Yungay"]);
    expect(childrenOf(matches, places[0].path)).toEqual([]);
  });

  test("un nodo guarda su localidad más parecida", () => {
    const chile = nodeOf(matches, ["América del Sur", "Chile"])!;
    const lowest = Math.min(...matches.filter((m) => m.zone.country === "Chile").map((m) => m.distance));
    expect(chile.best.distance).toBe(lowest);
    expect(nodeOf(matches, [])).toBeNull();
    expect(nodeOf(matches, ["Atlántida"])).toBeNull();
  });

  test("al cambiar el filtro, la ruta se recorta hasta donde sigue existiendo", () => {
    const onlyChile = matches.filter((m) => m.zone.country === "Chile");
    expect(trimPath(onlyChile, ["América del Sur", "Chile", "Antofagasta"])).toEqual([
      "América del Sur",
      "Chile",
      "Antofagasta",
    ]);
    expect(trimPath(onlyChile, ["América del Sur", "Ecuador", "Galápagos"])).toEqual(["América del Sur"]);
    expect(trimPath(onlyChile, ["Europa", "España"])).toEqual([]);
  });

  test("el centro de un grupo queda entre sus puntos, también al cruzar el antimeridiano", () => {
    const middle = centroid([
      { latitude: 0, longitude: 170 },
      { latitude: 0, longitude: -170 },
    ]);
    expect(Math.abs(middle.longitude)).toBeCloseTo(180, 6);
    expect(middle.latitude).toBeCloseTo(0, 6);
    expect(centroid([{ latitude: -22.92, longitude: -68.29 }]).latitude).toBeCloseTo(-22.92, 6);
  });

  test("el marcador de un grupo se ancla en uno de sus lugares, no en el punto medio", () => {
    const namib = { latitude: -23.56, longitude: 15.04 };
    const dallol = { latitude: 14.24, longitude: 40.3 };
    const erfoud = { latitude: 31.43, longitude: -4.23 };
    expect([namib, dallol]).toContain(anchor([namib, dallol]));
    expect(anchor([namib, dallol, erfoud])).toBe(dallol);
    expect(anchor([namib])).toBe(namib);
    for (let level = 0; level < 3; level++) {
      for (const node of nodesAt(matches, level)) {
        const members = matches.filter((m) => pathOf(m.zone)[level] === node.name);
        expect(members.some((m) => m.zone.latitude === node.latitude && m.zone.longitude === node.longitude)).toBe(true);
      }
    }
  });
});

describe("terreno real de la Luna y de la Tierra", () => {
  test("el polo sur tiene las nueve regiones candidatas de Artemis III", () => {
    expect(regionsOf("sur").map((r) => r.name)).toEqual([
      "Peak near Cabeus B",
      "Haworth",
      "Malapert Massif",
      "Mons Mouton Plateau",
      "Mons Mouton",
      "Nobile Rim 1",
      "Nobile Rim 2",
      "de Gerlache Rim 2",
      "Slater Plain",
    ]);
    for (const region of regionsOf("sur")) {
      expect(region.latitude).toBeLessThan(-83);
      expect(region.latitude).toBeGreaterThan(-90);
      expect(region.resolutionM).toBe(30);
      // Solo este producto informa qué parte de la elevación es medición directa.
      expect(region.measured).toBeGreaterThan(0);
      expect(region.measured).toBeLessThanOrEqual(1);
    }
    expect(lunarRegions.some((r) => r.id === DEFAULT_REGION)).toBe(true);
  });

  test("el polo norte y la zona central usan accidentes con nombre, cada uno en su sitio", () => {
    expect(regionsOf("norte").map((r) => r.name)).toEqual(["Peary", "Whipple", "Byrd", "Hermite", "Rozhdestvenskiy"]);
    for (const region of regionsOf("norte")) {
      expect(region.latitude).toBeGreaterThan(84);
      expect(region.resolutionM).toBe(30);
      expect(region.measured).toBeNull();
    }
    expect(regionsOf("central").map((r) => r.name)).toEqual([
      "Statio Tranquillitatis",
      "Mons Hadley",
      "Copernicus",
      "Marius",
      "Aristarchus",
      "Mons Pico",
    ]);
    for (const region of regionsOf("central")) {
      expect(Math.abs(region.latitude)).toBeLessThan(60);
      expect(Math.abs(region.longitude)).toBeLessThanOrEqual(180);
      // SLDEM2015 tiene unos 59 m por píxel: esta zona se compara a 60 m.
      expect(region.resolutionM).toBe(60);
    }
    expect(lunarRegions).toHaveLength(20);
  });

  test("cada región tiene sus descriptores y un nombre en español", () => {
    for (const region of lunarRegions) {
      expect(region.world).toBe("Luna");
      expect(region.windows).toBeGreaterThanOrEqual(9);
      expect(region.relief).toBeGreaterThan(0);
      expect(region.slope).toBeGreaterThan(0);
      expect(region.slope).toBeLessThan(90);
      expect(region.roughness).toBeGreaterThan(0);
      expect(region.spread.relief.q1).toBeLessThanOrEqual(region.relief);
      expect(region.spread.relief.q3).toBeGreaterThanOrEqual(region.relief);
      expect(region.nameEs.length).toBeGreaterThan(0);
    }
    for (const zone of LUNAR_ZONES) {
      expect(regionsOf(zone.id).some((r) => r.id === zone.first)).toBe(true);
    }
  });

  test("la pendiente calculada coincide con la que publica el producto del polo sur", () => {
    const checked = terrain.regions.flatMap((region) => (region.slopeCheck ? [region.slopeCheck] : []));
    expect(checked).toHaveLength(9);
    for (const check of checked) expect(Math.abs(check.own - check.pgda)).toBeLessThan(0.2);
  });

  test("cada recuadro lunar cabe en el mapa de su zona", () => {
    for (const region of lunarRegions) {
      const map = lunarMaps[region.zone];
      expect(region.box.xMin).toBeGreaterThan(map.xMin);
      expect(region.box.xMax).toBeLessThan(map.xMax);
      expect(region.box.yMin).toBeGreaterThan(map.yMin);
      expect(region.box.yMax).toBeLessThan(map.yMax);
    }
    for (const zone of LUNAR_ZONES) {
      const map = lunarMaps[zone.id];
      expect(map.width / map.height).toBeCloseTo((map.xMax - map.xMin) / (map.yMax - map.yMin), 1);
      expect(map.scale.units).toBeGreaterThan(0);
      expect(map.scale.units).toBeLessThan(map.xMax - map.xMin);
    }
    // Los polos se ven en su propio mapa; la zona central no contiene ninguno.
    expect(lunarMaps.sur.pole).toEqual({ x: 0, y: 0 });
    expect(lunarMaps.norte.pole).toEqual({ x: 0, y: 0 });
    expect(lunarMaps.central.pole).toBeNull();
  });

  test("el cálculo cubre la misma lista de lugares, con las mismas coordenadas", () => {
    // Si se añade o se mueve un lugar en places.json hay que volver a ejecutar scripts/terreno/calcular.py.
    expect(terrain.sites.map((s) => s.id).sort()).toEqual(places.map((p) => p.id).sort());
    for (const place of places) {
      const site = terrain.sites.find((s) => s.id === place.id)!;
      expect([site.latitude, site.longitude]).toEqual([place.latitude, place.longitude]);
    }
  });

  test("un lugar sin datos queda fuera con su motivo, nunca con ceros", () => {
    expect(measuredZones.length + unmeasuredZones.length).toBe(places.length);
    expect(measuredZones.length).toBeGreaterThanOrEqual(30);
    for (const zone of measuredZones) {
      expect(zone.relief).toBeGreaterThan(0);
      const survey = surveyOf(zone.id)!;
      expect(survey.windows).toBeGreaterThanOrEqual(terrain.method.minWindows);
      expect(survey.windows).toBeLessThanOrEqual(survey.windowsTotal);
    }
    for (const zone of unmeasuredZones) {
      expect(measuredZones.some((z) => z.name === zone.name)).toBe(false);
      expect(zone.reason.length).toBeGreaterThan(0);
    }
  });

  test("la Tierra se compara a la misma resolución que la zona lunar", () => {
    const haworth = lunarRegions.find((r) => r.id === "haworth")!;
    const copernicus = lunarRegions.find((r) => r.id === "copernicus")!;
    expect(zonesFor(haworth)).toBe(measuredZones);
    expect(zonesFor(copernicus)).toBe(coarseZones);
    expect(coarseZones.length).toBe(measuredZones.length);
    // A 60 m el terreno se ve más suave: la pendiente nunca sale mayor que a 30 m.
    for (const coarse of coarseZones) {
      const fine = measuredZones.find((z) => z.id === coarse.id)!;
      expect(coarse.slope).toBeLessThanOrEqual(fine.slope + 0.05);
    }
  });

  test("cada lugar se compara con la región lunar elegida", () => {
    const haworth = lunarRegions.find((r) => r.id === "haworth")!;
    const matches = matchZones(measuredZones, [haworth]);
    expect(matches).toHaveLength(measuredZones.length);
    expect(matches.every((m) => m.scenario.id === "haworth")).toBe(true);
    // La región por defecto muestra algo en cada nivel de parecido.
    for (const band of BANDS) {
      expect(matches.filter((m) => m.band === band.id).length).toBeGreaterThan(0);
    }
    // Un salar plano no se parece a un macizo lunar.
    const malapert = lunarRegions.find((r) => r.id === "malapert-massif")!;
    const flat = matchZones(measuredZones, [malapert]).find((m) => m.zone.id === "salar-de-atacama")!;
    expect(flat.band).toBe("baja");
    // Un mar lunar llano sí encuentra lugares parecidos entre los desiertos de la lista.
    const tranquility = lunarRegions.find((r) => r.id === "statio-tranquillitatis")!;
    expect(matchZones(zonesFor(tranquility), [tranquility]).some((m) => m.band === "alta")).toBe(true);
  });
});

describe("lector de TopoJSON", () => {
  // Dos cuadrados vecinos que comparten un lado (arco 1), con coordenadas cuantizadas.
  const topology: Topology = {
    type: "Topology",
    transform: { scale: [10, 10], translate: [-20, 0] },
    arcs: [
      [[1, 0], [-1, 0], [0, 1], [1, 0]],
      [[1, 1], [0, -1]],
      [[1, 0], [1, 0], [0, 1], [-1, 0]],
    ],
    objects: {
      countries: {
        type: "GeometryCollection",
        geometries: [
          { type: "Polygon", arcs: [[0, 1]], properties: { name: "Oeste" } },
          { type: "MultiPolygon", arcs: [[[-2, -3]]], id: "7" },
          { type: "Point" },
        ],
      },
    },
  };

  test("deshace la cuantización y las diferencias", () => {
    expect(decodeArcs(topology)[0]).toEqual([
      [-10, 0],
      [-20, 0],
      [-20, 10],
      [-10, 10],
    ]);
  });

  test("arma anillos cerrados y recorre al revés los arcos compartidos", () => {
    const [west, east] = shapesOf(topology, "countries");
    expect(west.name).toBe("Oeste");
    expect(west.rings[0][0]).toEqual(west.rings[0].at(-1)!);
    expect(east.name).toBe("7");
    expect(east.rings[0]).toEqual([
      [-10, 0],
      [-10, 10],
      [0, 10],
      [0, 0],
      [-10, 0],
    ]);
    expect(shapesOf(topology, "countries")).toHaveLength(2);
    expect(shapesOf(topology, "nada")).toEqual([]);
  });
});
