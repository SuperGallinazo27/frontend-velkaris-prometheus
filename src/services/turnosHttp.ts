/**
 * Portal de turnos contra el backend (FastAPI + PostgreSQL). Misma interfaz que la demostración.
 *
 * - Cada consulta lleva el token de la sesión. Los permisos, la regla de áreas protegidas y el
 *   choque de fechas los decide el servidor: ocultar un botón aquí no protege nada.
 * - Los mensajes fijos se escriben aquí, con la misma voz que el resto de la aplicación; los que
 *   dependen de datos del servidor (por qué un lugar está bloqueado) llegan de él.
 */
import { TURNO_MESSAGES, TurnoError, busyMessage, limitMessage } from "./turnosModel";
import type { Availability, BookingRequest, BusyRange, Reservation, TurnoErrorCode, TurnosApi } from "./turnosModel";
import type { DatasetState, Phase, PlaceState, PlaceStatus, ProtectedArea } from "./turnosRules";

/** Códigos del servidor → los que manejan las pantallas. */
const CODES: Record<string, TurnoErrorCode> = {
  place_busy: "ocupado",
  place_blocked: "bloqueado",
  permit_required: "permiso",
  invalid_dates: "fechas",
  too_many_reservations: "limite",
  place_not_found: "no-encontrado",
  reservation_not_found: "no-encontrado",
  already_cancelled: "ya-cancelado",
  reservation_finished: "terminado",
  reason_required: "motivo",
  not_blocked: "no-bloqueado",
  forbidden: "sin-permiso",
  not_authenticated: "sin-sesion",
  session_expired: "sin-sesion",
};

interface RawArea {
  site_id: number | null;
  name: string;
  designation: string | null;
  designation_eng: string | null;
  designation_type: string | null;
  iucn: string | null;
  status: string | null;
  status_year: number | null;
  governance: string | null;
  authority: string | null;
  iso3: string | null;
  strict: boolean;
}

interface RawPlace {
  id: string;
  name: string;
  province: string;
  country: string;
  status: PlaceState;
  bookable: boolean;
  permit_required: boolean;
  reason: string;
  dataset_status: DatasetState;
  areas: RawArea[];
  nearby_strict: RawArea[];
  override: { mode: "habilitado" | "cerrado"; reason: string; updated_at: string } | null;
  occupied_today: boolean;
  active_reservations: number;
}

interface RawBusy {
  start_date: string;
  end_date: string;
  mine: boolean;
  agency?: string | null;
}

interface RawReservation {
  id: string;
  code: string;
  place_id: string;
  place_name: string;
  start_date: string;
  end_date: string;
  days: number;
  status: "reservado" | "cancelado";
  phase: Phase;
  permit_reference: string | null;
  mission: string | null;
  robot: string | null;
  people: number | null;
  estimated_cost_usd: number | null;
  created_at: string;
  cancelled_at: string | null;
  cancelled_by: "admin" | "agencia" | null;
  cancel_reason: string | null;
  agency: { user_id: string; email: string; agency: string; acronym: string; country: string } | null;
}

const toArea = (raw: RawArea): ProtectedArea => ({
  siteId: raw.site_id,
  name: raw.name,
  designation: raw.designation,
  designationEng: raw.designation_eng,
  designationType: raw.designation_type,
  iucn: raw.iucn,
  status: raw.status,
  statusYear: raw.status_year,
  governance: raw.governance,
  authority: raw.authority,
  iso3: raw.iso3,
  strict: raw.strict,
});

export const toPlace = (raw: RawPlace): PlaceStatus => ({
  id: raw.id,
  name: raw.name,
  province: raw.province,
  country: raw.country,
  status: raw.status,
  bookable: raw.bookable,
  permitRequired: raw.permit_required,
  reason: raw.reason,
  datasetStatus: raw.dataset_status,
  areas: raw.areas.map(toArea),
  nearbyStrict: raw.nearby_strict.map(toArea),
  override: raw.override && { mode: raw.override.mode, reason: raw.override.reason, updatedAt: raw.override.updated_at },
  occupiedToday: raw.occupied_today,
  activeReservations: raw.active_reservations,
});

const toBusy = (raw: RawBusy): BusyRange => ({
  startDate: raw.start_date,
  endDate: raw.end_date,
  mine: raw.mine,
  agency: raw.agency ?? null,
});

export const toReservation = (raw: RawReservation): Reservation => ({
  id: raw.id,
  code: raw.code,
  placeId: raw.place_id,
  placeName: raw.place_name,
  startDate: raw.start_date,
  endDate: raw.end_date,
  days: raw.days,
  status: raw.status,
  phase: raw.phase,
  permitReference: raw.permit_reference,
  mission: raw.mission,
  robot: raw.robot,
  people: raw.people,
  estimatedCostUsd: raw.estimated_cost_usd,
  createdAt: raw.created_at,
  cancelledAt: raw.cancelled_at,
  cancelledBy: raw.cancelled_by,
  cancelReason: raw.cancel_reason,
  agency: raw.agency && {
    userId: raw.agency.user_id,
    email: raw.agency.email,
    agency: raw.agency.agency,
    acronym: raw.agency.acronym,
    country: raw.agency.country,
  },
});

/**
 * @param token el token de la sesión actual, o null si no hay.
 * @param onUnauthorized se llama cuando el servidor dice que la sesión ya no vale.
 */
export function createHttpTurnos(
  baseUrl: string,
  token: () => string | null,
  onUnauthorized: () => void,
  fetcher: typeof fetch = fetch,
): TurnosApi {
  const base = `${baseUrl.replace(/\/+$/, "")}/api/v1`;
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());

  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const sent = token();
    if (!sent) throw new TurnoError("sin-sesion", TURNO_MESSAGES.session);
    const headers: Record<string, string> = { Authorization: `Bearer ${sent}` };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    let response: Response;
    try {
      response = await fetcher(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch {
      throw new TurnoError(
        "servidor",
        "No se pudo conectar con el servidor de turnos. Revisa que esté encendido y tu conexión, e inténtalo de nuevo.",
      );
    }
    let data: unknown = null;
    try {
      data = await response.json();
    } catch {
      // Respuesta vacía o que no es JSON: se trata abajo según el estado.
    }
    if (response.ok) return data as T;

    const detail = (data as { detail?: { code?: string; message?: string; busy?: RawBusy[] } } | null)?.detail;
    // Un 404 sin código propio es de un servidor anterior al portal de turnos: aún no tiene estas rutas.
    if (response.status === 404 && typeof detail?.code !== "string") {
      throw new TurnoError("servidor", "Este servidor todavía no tiene el portal de turnos. Reinicia la API para cargar la versión nueva.");
    }
    const code = CODES[detail?.code ?? ""] ?? "servidor";
    if (code === "sin-sesion") onUnauthorized();
    if (code === "ocupado" && detail?.busy?.length) {
      const busy = detail.busy.map(toBusy);
      throw new TurnoError(code, busyMessage(busy[0]), busy);
    }
    if (code === "limite") throw new TurnoError(code, limitMessage());
    if (code === "permiso") throw new TurnoError(code, TURNO_MESSAGES.permit);
    if (code === "motivo") throw new TurnoError(code, TURNO_MESSAGES.reason);
    throw new TurnoError(code, detail?.message ?? TURNO_MESSAGES.server);
  }

  /** Quita lo que no se envió: el servidor rechaza campos vacíos que no espera. */
  const compact = (fields: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined && value !== null && value !== ""));

  return {
    mode: "servidor",

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    async places() {
      const data = await call<{ places: RawPlace[] }>("GET", "/places");
      return data.places.map(toPlace);
    },

    async availability(placeId): Promise<Availability> {
      const data = await call<{ place: RawPlace; busy: RawBusy[]; today: string }>(
        "GET",
        `/places/${encodeURIComponent(placeId)}/availability`,
      );
      return { place: toPlace(data.place), busy: data.busy.map(toBusy), today: data.today };
    },

    async mine() {
      const data = await call<{ reservations: RawReservation[] }>("GET", "/reservations/mine");
      return data.reservations.map(toReservation);
    },

    async book(request: BookingRequest) {
      const raw = await call<RawReservation>(
        "POST",
        "/reservations",
        compact({
          place_id: request.placeId,
          start_date: request.startDate,
          end_date: request.endDate,
          permit_reference: request.permitReference?.trim(),
          mission: request.mission?.trim(),
          robot: request.robot?.trim(),
          people: request.people,
          estimated_cost_usd: request.estimatedCostUsd,
        }),
      );
      notify();
      return toReservation(raw);
    },

    async cancel(reservationId, reason) {
      const raw = await call<RawReservation>(
        "POST",
        `/reservations/${encodeURIComponent(reservationId)}/cancel`,
        compact({ reason: reason?.trim() }),
      );
      notify();
      return toReservation(raw);
    },

    async all() {
      const data = await call<{ reservations: RawReservation[] }>("GET", "/reservations");
      return data.reservations.map(toReservation);
    },

    async setOverride(placeId, mode, reason) {
      const raw = await call<RawPlace>("POST", `/places/${encodeURIComponent(placeId)}/override`, { mode, reason });
      notify();
      return toPlace(raw);
    },

    async clearOverride(placeId) {
      const raw = await call<RawPlace>("DELETE", `/places/${encodeURIComponent(placeId)}/override`);
      notify();
      return toPlace(raw);
    },
  };
}
