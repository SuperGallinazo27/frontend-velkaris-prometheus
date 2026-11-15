/**
 * Portal de turnos: lo que comparten la versión con servidor (`turnosHttp.ts`) y la demostración
 * guardada en el navegador (`turnosLocal.ts`). `turnos.ts` elige cuál se usa.
 *
 * Un turno es un rango de días en el que una agencia tiene un lugar. Coordina a las agencias de
 * este portal: no reemplaza los permisos del país, del dueño del terreno ni de la autoridad de un
 * área protegida.
 */
import { LIMITS, rangeText } from "./turnosRules";
import type { Phase, PlaceStatus } from "./turnosRules";

export interface AgencyInfo {
  userId: string;
  email: string;
  agency: string;
  acronym: string;
  country: string;
}

export interface Reservation {
  id: string;
  /** Referencia corta para citar el turno: «TUR-7K3Q9D». */
  code: string;
  placeId: string;
  placeName: string;
  startDate: string;
  endDate: string;
  days: number;
  status: "reservado" | "cancelado";
  phase: Phase;
  /** Permiso que declaró la agencia cuando el lugar está en un área protegida. Nadie lo verifica aquí. */
  permitReference: string | null;
  mission: string | null;
  robot: string | null;
  people: number | null;
  estimatedCostUsd: number | null;
  createdAt: string;
  cancelledAt: string | null;
  cancelledBy: "admin" | "agencia" | null;
  cancelReason: string | null;
  agency: AgencyInfo | null;
}

/** Días ocupados de un lugar. Una agencia no ve de quién son; el administrador sí. */
export interface BusyRange {
  startDate: string;
  endDate: string;
  mine: boolean;
  agency: string | null;
}

export interface Availability {
  place: PlaceStatus;
  /** Turnos reservados que aún no terminan, del más próximo al más lejano. */
  busy: BusyRange[];
  today: string;
}

export interface BookingRequest {
  placeId: string;
  startDate: string;
  endDate: string;
  permitReference?: string;
  mission?: string;
  robot?: string;
  people?: number;
  estimatedCostUsd?: number;
}

export type TurnoErrorCode =
  | "ocupado"
  | "bloqueado"
  | "permiso"
  | "fechas"
  | "limite"
  | "no-encontrado"
  | "ya-cancelado"
  | "terminado"
  | "motivo"
  | "no-bloqueado"
  | "sin-permiso"
  | "sin-sesion"
  | "servidor";

export class TurnoError extends Error {
  code: TurnoErrorCode;
  /** Con `ocupado`: los turnos que chocan con las fechas pedidas. */
  busy: BusyRange[];
  constructor(code: TurnoErrorCode, message: string, busy: BusyRange[] = []) {
    super(message);
    this.name = "TurnoError";
    this.code = code;
    this.busy = busy;
  }
}

export interface TurnosApi {
  /** `servidor`: turnos en la base de datos del backend. `local`: demostración en este navegador. */
  readonly mode: "local" | "servidor";
  /** Estado de todos los lugares de la lista. */
  places(): Promise<PlaceStatus[]>;
  /** Estado de un lugar y sus días ocupados. */
  availability(placeId: string): Promise<Availability>;
  /** Turnos de la agencia que tiene la sesión, del más reciente al más antiguo. */
  mine(): Promise<Reservation[]>;
  /** Solo agencias. Si el lugar está libre en esas fechas, el turno queda reservado al instante. */
  book(request: BookingRequest): Promise<Reservation>;
  /** La agencia cancela un turno suyo; el administrador, cualquiera, y debe dar el motivo. */
  cancel(reservationId: string, reason?: string): Promise<Reservation>;
  /** Solo administrador: todos los turnos, con su agencia. */
  all(): Promise<Reservation[]>;
  /** Solo administrador: cierra un lugar o habilita uno que la regla de áreas protegidas bloquea. */
  setOverride(placeId: string, mode: "habilitado" | "cerrado", reason: string): Promise<PlaceStatus>;
  /** Solo administrador: quita su decisión; el lugar vuelve a lo que dice la base de datos. */
  clearOverride(placeId: string): Promise<PlaceStatus>;
  /** Avisa cada vez que cambia algo (un turno nuevo, una cancelación, una decisión sobre un lugar). */
  subscribe(listener: () => void): () => void;
}

/** Los mismos textos con servidor y sin él, para que la aplicación hable siempre igual. */
export const TURNO_MESSAGES = {
  session: "Inicia sesión para continuar.",
  agencyOnly: "Los turnos los reservan las agencias; el administrador los gestiona.",
  adminOnly: "Solo el administrador puede hacer esto.",
  registration: "Completa tu registro para usar el portal de turnos.",
  placeNotFound: "Ese lugar no está en la lista.",
  reservationNotFound: "Ese turno ya no existe.",
  permit: "Este lugar está dentro de un área protegida: escribe el número o la referencia del permiso de su autoridad.",
  reason: "Escribe el motivo.",
  alreadyCancelled: "Ese turno ya estaba cancelado.",
  finished: "Ese turno ya terminó: no se puede cancelar.",
  server: "El servidor no pudo completar la acción. Inténtalo de nuevo.",
} as const;

/** «Ocupado: otra agencia tiene este lugar del 3 al 12 de marzo de 2027.» */
export function busyMessage(range: Pick<BusyRange, "startDate" | "endDate" | "mine">): string {
  const who = range.mine ? "Tu agencia ya tiene este lugar" : "Ocupado: otra agencia tiene este lugar";
  return `${who} ${rangeText(range.startDate, range.endDate)}.`;
}

export const limitMessage = () =>
  `Tu agencia ya tiene ${LIMITS.maxActivePerAgency} turnos activos. Cancela uno o espera a que termine para reservar otro.`;
