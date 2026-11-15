/**
 * Portal de turnos que usa toda la aplicación. Con `VITE_API_BASE_URL`, los turnos viven en la
 * base de datos del servidor; sin ella, en la demostración guardada en este navegador. Es la misma
 * elección que hace `session.ts` con las cuentas.
 */
import type { StorageLike } from "./auth";
import { TOKEN_KEY } from "./authHttp";
import { auth } from "./session";
import { createHttpTurnos } from "./turnosHttp";
import { createLocalTurnos } from "./turnosLocal";
import type { TurnosApi } from "./turnosModel";

export { TURNO_MESSAGES, TurnoError } from "./turnosModel";
export type { AgencyInfo, Availability, BookingRequest, BusyRange, Reservation, TurnoErrorCode, TurnosApi } from "./turnosModel";

/** Almacenamiento del navegador; si está bloqueado, funciona en memoria hasta recargar. */
function browserStorage(): StorageLike {
  try {
    window.localStorage.getItem(TOKEN_KEY);
    return window.localStorage;
  } catch {
    const memory = new Map<string, string>();
    return {
      getItem: (key) => memory.get(key) ?? null,
      setItem: (key, value) => void memory.set(key, value),
      removeItem: (key) => void memory.delete(key),
    };
  }
}

const apiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim();
const storage = browserStorage();

export const turnos: TurnosApi = apiBase
  ? createHttpTurnos(
      apiBase,
      () => storage.getItem(TOKEN_KEY),
      // La sesión venció o se anuló: se sale, igual que hace el servicio de cuentas.
      () => auth.logout(),
    )
  : createLocalTurnos(storage, () => auth.session());
