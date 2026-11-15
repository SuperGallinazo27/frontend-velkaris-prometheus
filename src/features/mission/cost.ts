/**
 * Estimación del costo de una campaña de ensayo en un lugar, desde el punto de salida del equipo.
 *
 * La distancia es real (círculo máximo entre los dos puntos). Las tarifas son SUPUESTOS de
 * ejemplo que la pantalla deja cambiar: sirven para comparar lugares entre sí, no son
 * cotizaciones. Presupuesta la campaña en la Tierra, no una misión espacial.
 */

export interface Point {
  latitude: number;
  longitude: number;
}

export interface City extends Point {
  name: string;
  country: string;
}

/** Puntos de salida habituales, por si el navegador no comparte la ubicación. */
export const CITIES: City[] = [
  { name: "Guayaquil", country: "Ecuador", latitude: -2.19, longitude: -79.89 },
  { name: "Quito", country: "Ecuador", latitude: -0.18, longitude: -78.47 },
  { name: "Bogotá", country: "Colombia", latitude: 4.71, longitude: -74.07 },
  { name: "Lima", country: "Perú", latitude: -12.05, longitude: -77.04 },
  { name: "Santiago", country: "Chile", latitude: -33.45, longitude: -70.67 },
  { name: "Buenos Aires", country: "Argentina", latitude: -34.6, longitude: -58.38 },
  { name: "São Paulo", country: "Brasil", latitude: -23.55, longitude: -46.63 },
  { name: "Ciudad de México", country: "México", latitude: 19.43, longitude: -99.13 },
  { name: "Houston", country: "Estados Unidos", latitude: 29.76, longitude: -95.37 },
  { name: "Washington D. C.", country: "Estados Unidos", latitude: 38.91, longitude: -77.04 },
  { name: "Madrid", country: "España", latitude: 40.42, longitude: -3.7 },
  { name: "París", country: "Francia", latitude: 48.86, longitude: 2.35 },
  { name: "Darmstadt", country: "Alemania", latitude: 49.87, longitude: 8.65 },
  { name: "Bangalore", country: "India", latitude: 12.97, longitude: 77.59 },
  { name: "Tokio", country: "Japón", latitude: 35.68, longitude: 139.69 },
  { name: "Sídney", country: "Australia", latitude: -33.87, longitude: 151.21 },
];

const EARTH_RADIUS_KM = 6371;

/** Distancia por la superficie entre dos puntos (fórmula del haversine), en kilómetros. */
export function haversineKm(a: Point, b: Point): number {
  const rad = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * rad;
  const dLon = (b.longitude - a.longitude) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Tarifas de ejemplo, en dólares. Todas se pueden cambiar en la pantalla. */
export interface Assumptions {
  /** Pasaje: parte fija por persona y trayecto. */
  flightBase: number;
  /** Pasaje: por persona y kilómetro. */
  flightPerKm: number;
  /** Carga: parte fija por kilo y trayecto. */
  cargoBasePerKg: number;
  /** Carga: por kilo y kilómetro. */
  cargoPerKgKm: number;
  /** Alojamiento, comida y campamento, por persona y día. */
  perDiem: number;
  /** Vehículos, combustible y apoyo local, por día. */
  localSupportPerDay: number;
  /** Permisos y seguros de la campaña. */
  permits: number;
  /** Reserva para imprevistos, en porcentaje. */
  contingency: number;
}

export const DEFAULT_ASSUMPTIONS: Assumptions = {
  flightBase: 150,
  flightPerKm: 0.11,
  cargoBasePerKg: 2,
  cargoPerKgKm: 0.0006,
  perDiem: 120,
  localSupportPerDay: 450,
  permits: 2500,
  contingency: 15,
};

export const ASSUMPTION_LABELS: Record<keyof Assumptions, string> = {
  flightBase: "Pasaje, parte fija por persona y trayecto",
  flightPerKm: "Pasaje por persona y km",
  cargoBasePerKg: "Carga, parte fija por kg y trayecto",
  cargoPerKgKm: "Carga por kg y km",
  perDiem: "Campamento y comida por persona y día",
  localSupportPerDay: "Vehículos y apoyo local por día",
  permits: "Permisos y seguros",
  contingency: "Imprevistos (%)",
};

export const LIMITS = { people: [1, 15], cargoKg: [0, 5000], days: [1, 120] } as const;

export interface CampaignInput {
  distanceKm: number;
  people: number;
  cargoKg: number;
  days: number;
  /** Multiplicador del trabajo de campo según la temporada elegida (1 = sin recargo). */
  seasonFactor: number;
}

export interface CampaignCost {
  /** Ida y vuelta del equipo. */
  flights: number;
  /** Ida y vuelta del robot, las baterías y los instrumentos. */
  cargo: number;
  /** Campamento, comida, vehículos y apoyo local, con el recargo de la temporada. */
  field: number;
  permits: number;
  contingency: number;
  total: number;
  perDay: number;
}

const clamp = (value: number, [min, max]: readonly [number, number]) =>
  Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));

export function estimateCampaign(input: CampaignInput, assumptions: Assumptions = DEFAULT_ASSUMPTIONS): CampaignCost {
  const people = Math.round(clamp(input.people, LIMITS.people));
  const days = Math.round(clamp(input.days, LIMITS.days));
  const cargoKg = clamp(input.cargoKg, LIMITS.cargoKg);
  const distance = Math.max(0, Number.isFinite(input.distanceKm) ? input.distanceKm : 0);
  const season = Math.max(1, Number.isFinite(input.seasonFactor) ? input.seasonFactor : 1);
  const rate = (key: keyof Assumptions) => Math.max(0, Number.isFinite(assumptions[key]) ? assumptions[key] : 0);

  const flights = people * 2 * (rate("flightBase") + rate("flightPerKm") * distance);
  const cargo = cargoKg * 2 * (rate("cargoBasePerKg") + rate("cargoPerKgKm") * distance);
  const field = (people * days * rate("perDiem") + days * rate("localSupportPerDay")) * season;
  const permits = rate("permits");
  const contingency = ((flights + cargo + field + permits) * rate("contingency")) / 100;
  const total = flights + cargo + field + permits + contingency;
  return { flights, cargo, field, permits, contingency, total, perDay: total / days };
}

/** Dólares sin decimales y con los miles separados por un espacio fino: «12 345 USD». */
export const usd = (value: number) =>
  `${Math.round(value)
    .toLocaleString("es", { useGrouping: "always" } as Intl.NumberFormatOptions)
    .replace(/\./g, " ")} USD`;
