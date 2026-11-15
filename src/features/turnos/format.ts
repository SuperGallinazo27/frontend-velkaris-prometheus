/** Textos que comparten las pantallas de turnos. */
import { IUCN_NAMES, designationText, protectedSource } from "../../services/turnosRules";
import type { PlaceState, ProtectedArea } from "../../services/turnosRules";

const ENGLISH_MONTHS: Record<string, string> = {
  January: "enero",
  February: "febrero",
  March: "marzo",
  April: "abril",
  May: "mayo",
  June: "junio",
  July: "julio",
  August: "agosto",
  September: "septiembre",
  October: "octubre",
  November: "noviembre",
  December: "diciembre",
};

/** «October 2026» → «octubre de 2026». La fuente pide que el mes de la versión esté a la vista. */
export function releaseText(release: string | null): string {
  if (!release) return "versión sin fecha";
  const [month, year] = release.split(" ");
  return ENGLISH_MONTHS[month] && year ? `${ENGLISH_MONTHS[month]} de ${year}` : release;
}

export const SOURCE_RELEASE = releaseText(protectedSource.release);

/** «Parque Nacional · UICN II, parque nacional» o «Sitio Ramsar · sin categoría UICN informada». */
export function areaDetail(area: ProtectedArea): string {
  const designation = designationText(area) ?? "Área protegida";
  const category =
    area.iucn && area.iucn in IUCN_NAMES ? `UICN ${area.iucn}, ${IUCN_NAMES[area.iucn]}` : "sin categoría UICN informada";
  return `${designation} · ${category}`;
}

/** Autoridad que la base informa para un área, o null si no la informa. */
export const areaAuthority = (area: ProtectedArea) =>
  area.authority && area.authority !== "Not Reported" ? area.authority : null;

/** Símbolo y tono de cada estado: nunca se distingue solo por el color. */
export const STATE_MARK: Record<PlaceState, { symbol: string; tone: "bien" | "medio" | "mal" }> = {
  libre: { symbol: "✓", tone: "bien" },
  permiso: { symbol: "!", tone: "medio" },
  habilitado: { symbol: "!", tone: "medio" },
  protegido: { symbol: "✕", tone: "mal" },
  cerrado: { symbol: "✕", tone: "mal" },
  sin_dato: { symbol: "?", tone: "mal" },
};

/** «19 069 USD», igual que en el centro de misión. */
export const usd = (value: number) =>
  `${Math.round(value)
    .toLocaleString("es", { useGrouping: "always" } as Intl.NumberFormatOptions)
    .replace(/\./g, " ")} USD`;

/** «14 nov 2026», para fechas con hora del servidor. */
export const shortDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("es", { day: "2-digit", month: "short", year: "numeric" }) : "—";
