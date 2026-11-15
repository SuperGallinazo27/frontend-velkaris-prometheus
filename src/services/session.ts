import { useSyncExternalStore } from "react";
import { demoAccounts } from "../data/demoAccounts";
import { createAuth } from "./auth";
import type { AuthApi, StorageLike, User } from "./auth";
import { createHttpAuth } from "./authHttp";

/** Almacenamiento del navegador; si está bloqueado, funciona en memoria hasta recargar. */
function browserStorage(): StorageLike {
  try {
    window.localStorage.getItem("prometheus.demo");
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

/**
 * Dirección del backend (`VITE_API_BASE_URL`). Con ella, las cuentas viven en la base de datos
 * del servidor; sin ella, se usa la demostración guardada en este navegador.
 */
const apiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim();

/** Servicio de cuentas que usa toda la aplicación. */
export const auth: AuthApi = apiBase
  ? createHttpAuth(apiBase, browserStorage())
  : createAuth(browserStorage(), demoAccounts);

/** Sesión actual; el componente se actualiza al iniciar o cerrar sesión. */
export function useSession(): User | null {
  return useSyncExternalStore(auth.subscribe, auth.session);
}

/** true mientras se comprueba una sesión guardada: todavía no se sabe si hay que pedir el ingreso. */
export function useSessionPending(): boolean {
  return useSyncExternalStore(auth.subscribe, auth.pending);
}
