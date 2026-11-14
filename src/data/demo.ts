import type { Terrain } from "../types/analysis";
// Entire dataset is synthetic. Place names are geographical references only.
// Coordinates are illustrative centers; descriptors are not measurements.
export const regions: Terrain[] = [
  {
    id: "gale",
    name: "Cráter Gale",
    context: "Marte · escenario A",
    relief: 850,
    slope: 12,
    roughness: 55,
    latitude: -5.4,
    longitude: 137.8,
  },
  {
    id: "jezero",
    name: "Cráter Jezero",
    context: "Marte · escenario B",
    relief: 400,
    slope: 5,
    roughness: 30,
    latitude: 18.4,
    longitude: 77.5,
  },
  {
    id: "valles",
    name: "Valles Marineris",
    context: "Marte · escenario C",
    relief: 2200,
    slope: 24,
    roughness: 100,
    latitude: -14,
    longitude: -59,
  },
];
export const candidates: Terrain[] = [
  {
    id: "atacama",
    name: "Desierto de Atacama",
    context: "Chile · Tierra",
    relief: 720,
    slope: 10,
    roughness: 48,
    latitude: -24.5,
    longitude: -69.2,
  },
  {
    id: "iceland",
    name: "Tierras altas de Islandia",
    context: "Islandia · Tierra",
    relief: 460,
    slope: 7,
    roughness: 35,
    latitude: 64.8,
    longitude: -18,
  },
  {
    id: "utah",
    name: "Meseta de Colorado",
    context: "Estados Unidos · Tierra",
    relief: 1800,
    slope: 21,
    roughness: 90,
    latitude: 37,
    longitude: -110,
  },
];
export const demoRisks = [
  {
    name: "Acceso al terreno",
    level: "Medio",
    value: 2,
    detail:
      "Ejemplo de logística de una campaña terrestre. Requiere estudio local.",
  },
  {
    name: "Exposición ambiental",
    level: "Alto",
    value: 3,
    detail:
      "Categoría ilustrativa; no corresponde a un pronóstico meteorológico.",
  },
  {
    name: "Disponibilidad de datos",
    level: "Alto",
    value: 3,
    detail:
      "Solo hay datos sintéticos. Falta validación de fuentes y resolución.",
  },
  {
    name: "Complejidad operativa",
    level: "Bajo",
    value: 1,
    detail:
      "Valor ficticio para probar la interfaz. No es una evaluación real.",
  },
];
