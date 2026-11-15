/**
 * Portal de turnos de DEMOSTRACIÓN, sin servidor: los turnos se guardan en este navegador.
 *
 * Aplica las mismas reglas que el servidor y en el mismo orden (lugar, fechas, área protegida,
 * permiso, choque de fechas, límite por agencia). Como todo vive en un solo navegador, «otra
 * agencia» es otra cuenta de demostración abierta aquí mismo. No protege nada: cualquiera con
 * acceso a este equipo puede cambiar lo guardado.
 */
import type { StorageLike, User } from "./auth";
import { TURNO_MESSAGES, TurnoError, busyMessage, limitMessage } from "./turnosModel";
import type { AgencyInfo, Availability, BookingRequest, BusyRange, Reservation, TurnosApi } from "./turnosModel";
import {
  LIMITS,
  PAST_TOLERANCE_DAYS,
  addDays,
  datasetPlace,
  datasetPlaces,
  datasetStateOf,
  daysIn,
  overlaps,
  phaseOf,
  placeStatus,
  rangeProblem,
  toIsoDate,
} from "./turnosRules";
import type { PlaceOverride, PlaceStatus } from "./turnosRules";

export const TURNOS_KEY = "prometheus.demo.turnos.v1";

/** Lo que se guarda de un turno: la fase y los días se calculan al leer. */
type StoredReservation = Omit<Reservation, "phase" | "days" | "agency"> & { agency: AgencyInfo };

interface Stored {
  reservations: StoredReservation[];
  overrides: Record<string, PlaceOverride>;
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function randomText(length: number, alphabet: string): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

const clean = (text: string | undefined) => text?.trim() || null;

export function createLocalTurnos(
  storage: StorageLike,
  session: () => User | null,
  now: () => Date = () => new Date(),
): TurnosApi {
  const listeners = new Set<() => void>();

  function read(): Stored {
    try {
      const parsed = JSON.parse(storage.getItem(TURNOS_KEY) ?? "null") as Partial<Stored> | null;
      return {
        reservations: Array.isArray(parsed?.reservations) ? parsed.reservations : [],
        overrides: parsed?.overrides && typeof parsed.overrides === "object" ? parsed.overrides : {},
      };
    } catch {
      return { reservations: [], overrides: {} };
    }
  }

  function write(next: Stored) {
    storage.setItem(TURNOS_KEY, JSON.stringify(next));
    listeners.forEach((listener) => listener());
  }

  const today = () => toIsoDate(now());

  /** La cuenta con sesión, si ya completó su registro. */
  function activeUser(): User {
    const user = session();
    if (!user) throw new TurnoError("sin-sesion", TURNO_MESSAGES.session);
    if (user.status !== "activo") throw new TurnoError("sin-permiso", TURNO_MESSAGES.registration);
    return user;
  }

  function admin(): User {
    const user = activeUser();
    if (user.role !== "admin") throw new TurnoError("sin-permiso", TURNO_MESSAGES.adminOnly);
    return user;
  }

  function place(placeId: string) {
    const found = datasetPlace(placeId);
    if (!found) throw new TurnoError("no-encontrado", TURNO_MESSAGES.placeNotFound);
    return found;
  }

  /** Turnos reservados que aún no terminan. */
  const active = (stored: Stored) => stored.reservations.filter((r) => r.status === "reservado" && r.endDate >= today());

  function statusOf(stored: Stored, placeId: string): PlaceStatus {
    const here = active(stored).filter((r) => r.placeId === placeId);
    return placeStatus(place(placeId), stored.overrides[placeId] ?? null, {
      occupiedToday: here.some((r) => r.startDate <= today()),
      activeReservations: here.length,
    });
  }

  const toReservation = (stored: StoredReservation): Reservation => ({
    ...stored,
    days: daysIn(stored.startDate, stored.endDate),
    phase: phaseOf(stored.status, stored.startDate, stored.endDate, today()),
  });

  return {
    mode: "local",

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    async places() {
      activeUser();
      const stored = read();
      return datasetPlaces.map((item) => statusOf(stored, item.id));
    },

    async availability(placeId): Promise<Availability> {
      const user = activeUser();
      const stored = read();
      const busy: BusyRange[] = active(stored)
        .filter((r) => r.placeId === placeId)
        .sort((a, b) => a.startDate.localeCompare(b.startDate))
        .map((r) => ({
          startDate: r.startDate,
          endDate: r.endDate,
          mine: r.agency.userId === user.id,
          agency: user.role === "admin" ? r.agency.agency || r.agency.email : null,
        }));
      return { place: statusOf(stored, placeId), busy, today: today() };
    },

    async mine() {
      const user = activeUser();
      return read()
        .reservations.filter((r) => r.agency.userId === user.id)
        .sort((a, b) => b.startDate.localeCompare(a.startDate) || b.createdAt.localeCompare(a.createdAt))
        .map(toReservation);
    },

    async book(request: BookingRequest) {
      const user = activeUser();
      if (user.role !== "agencia") throw new TurnoError("sin-permiso", TURNO_MESSAGES.agencyOnly);
      const target = place(request.placeId);
      const problem = rangeProblem(request.startDate, request.endDate, today());
      if (problem) throw new TurnoError("fechas", problem);
      const stored = read();
      const status = statusOf(stored, target.id);
      if (!status.bookable) throw new TurnoError("bloqueado", `${target.name} no se puede reservar. ${status.reason}`);
      const permit = clean(request.permitReference);
      if (status.permitRequired && !permit) throw new TurnoError("permiso", TURNO_MESSAGES.permit);

      const taken = stored.reservations
        .filter(
          (r) =>
            r.placeId === target.id &&
            r.status === "reservado" &&
            overlaps(r.startDate, r.endDate, request.startDate, request.endDate),
        )
        .sort((a, b) => a.startDate.localeCompare(b.startDate));
      if (taken.length) {
        const busy = taken.map((r) => ({
          startDate: r.startDate,
          endDate: r.endDate,
          mine: r.agency.userId === user.id,
          agency: null,
        }));
        throw new TurnoError("ocupado", busyMessage(busy[0]), busy);
      }
      if (active(stored).filter((r) => r.agency.userId === user.id).length >= LIMITS.maxActivePerAgency) {
        throw new TurnoError("limite", limitMessage());
      }

      const reservation: StoredReservation = {
        id: randomText(16, "abcdefghijklmnopqrstuvwxyz0123456789"),
        code: `TUR-${randomText(6, CODE_ALPHABET)}`,
        placeId: target.id,
        placeName: target.name,
        startDate: request.startDate,
        endDate: request.endDate,
        status: "reservado",
        permitReference: status.permitRequired ? permit : null,
        mission: clean(request.mission),
        robot: clean(request.robot),
        people: request.people ?? null,
        estimatedCostUsd: request.estimatedCostUsd ?? null,
        createdAt: now().toISOString(),
        cancelledAt: null,
        cancelledBy: null,
        cancelReason: null,
        agency: {
          userId: user.id,
          email: user.email,
          agency: user.profile?.agency ?? "",
          acronym: user.profile?.acronym ?? "",
          country: user.profile?.country ?? "",
        },
      };
      write({ ...stored, reservations: [...stored.reservations, reservation] });
      return toReservation(reservation);
    },

    async cancel(reservationId, reason) {
      const user = activeUser();
      const stored = read();
      const found = stored.reservations.find((r) => r.id === reservationId);
      // El turno de otra agencia se ve igual que uno que no existe.
      if (!found || (user.role !== "admin" && found.agency.userId !== user.id)) {
        throw new TurnoError("no-encontrado", TURNO_MESSAGES.reservationNotFound);
      }
      if (found.status === "cancelado") throw new TurnoError("ya-cancelado", TURNO_MESSAGES.alreadyCancelled);
      if (found.endDate < addDays(today(), -PAST_TOLERANCE_DAYS)) throw new TurnoError("terminado", TURNO_MESSAGES.finished);
      const why = clean(reason);
      if (user.role === "admin" && !why) throw new TurnoError("motivo", TURNO_MESSAGES.reason);
      const cancelled: StoredReservation = {
        ...found,
        status: "cancelado",
        cancelledAt: now().toISOString(),
        cancelledBy: user.role,
        cancelReason: why,
      };
      write({ ...stored, reservations: stored.reservations.map((r) => (r.id === reservationId ? cancelled : r)) });
      return toReservation(cancelled);
    },

    async all() {
      admin();
      return read()
        .reservations.slice()
        .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.createdAt.localeCompare(b.createdAt))
        .map(toReservation);
    },

    async setOverride(placeId, mode, reason) {
      admin();
      const target = place(placeId);
      const why = clean(reason);
      if (!why) throw new TurnoError("motivo", TURNO_MESSAGES.reason);
      const state = datasetStateOf(target.areas);
      if (mode === "habilitado" && state !== "protegido" && state !== "sin_dato") {
        throw new TurnoError(
          "no-bloqueado",
          `${target.name} no está bloqueado por un área protegida: no hace falta habilitarlo.`,
        );
      }
      const stored = read();
      const next = { ...stored, overrides: { ...stored.overrides, [placeId]: { mode, reason: why, updatedAt: now().toISOString() } } };
      write(next);
      return statusOf(next, placeId);
    },

    async clearOverride(placeId) {
      admin();
      place(placeId);
      const stored = read();
      const { [placeId]: _removed, ...overrides } = stored.overrides;
      const next = { ...stored, overrides };
      write(next);
      return statusOf(next, placeId);
    },
  };
}
