/** Formato de números y coordenadas en español. */
/**
 * Los miles se separan con un espacio fino («10 324 km»): el punto que usa el navegador en español
 * se confunde con un decimal al lado de cifras con coma.
 */
export const decimal = (value: number, digits = 0) =>
  value
    .toLocaleString("es", { maximumFractionDigits: digits, useGrouping: "always" } as Intl.NumberFormatOptions)
    .replace(/\./g, " ");

export const percent = (fraction: number) => `${Math.round(fraction * 100)} %`;

export function coordinates(latitude: number, longitude: number): string {
  const part = (value: number, positive: string, negative: string) =>
    `${decimal(Math.abs(value), 2)}° ${value >= 0 ? positive : negative}`;
  return `${part(latitude, "N", "S")}, ${part(longitude, "E", "O")}`;
}
