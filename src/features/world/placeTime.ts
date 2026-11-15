/**
 * La hora de un lugar, dicha con claridad: en qué zona horaria está, cuánto se aparta de la de
 * quien mira y qué hora es allí ahora. Funciones puras.
 *
 * Hace falta porque el clima «de ahora» no es de este instante ni está en la hora de quien mira:
 * el modelo meteorológico calcula cada cuarto de hora y entrega la hora del lugar. Galápagos, por
 * ejemplo, va una hora por detrás del Ecuador continental.
 */

/** «hora de Galápagos», «hora estándar de Perú»; si el navegador no conoce la zona, su nombre técnico. */
export function zoneName(timezone: string, at: Date = new Date()): string {
  if (!timezone) return "hora del lugar";
  try {
    const part = new Intl.DateTimeFormat("es", { timeZone: timezone, timeZoneName: "long" })
      .formatToParts(at)
      .find((item) => item.type === "timeZoneName");
    if (part?.value) return part.value;
  } catch {
    // Zona desconocida para este navegador: se muestra tal cual.
  }
  return `hora de ${timezone.split("/").pop()!.replace(/_/g, " ")}`;
}

/** Horas que el lugar va por delante (+) o por detrás (−) de quien mira. */
export function hoursAhead(placeOffsetSeconds: number, viewerOffsetMinutes: number): number {
  return placeOffsetSeconds / 3600 - viewerOffsetMinutes / 60;
}

/** Minutos que la zona de este navegador se aparta de UTC (Ecuador continental: −300). */
export const viewerOffsetMinutes = (at: Date = new Date()) => -at.getTimezoneOffset();

/** «1 h menos que tu hora», «5 h 30 min más que tu hora»; null si es la misma hora. */
export function differenceText(hours: number): string | null {
  const minutes = Math.round(Math.abs(hours) * 60);
  if (minutes === 0) return null;
  const whole = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const amount = [whole ? `${whole} h` : "", rest ? `${rest} min` : ""].filter(Boolean).join(" ");
  return `${amount} ${hours < 0 ? "menos" : "más"} que tu hora`;
}

/** La hora de ahora en el lugar: «07:41». */
export function clockAt(nowMs: number, utcOffsetSeconds: number): string {
  return new Date(nowMs + utcOffsetSeconds * 1000).toISOString().slice(11, 16);
}

/** `2026-11-15T07:30` → «07:30». */
export const clockOf = (time: string): string => time.slice(11, 16);

const WEEKDAYS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

/** `2026-11-16` → «lunes 16». La fecha ya viene en el día del lugar: no se convierte de zona. */
export function dayLabel(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return `${WEEKDAYS[weekday]} ${day}`;
}
