/**
 * Cuentas y sesión contra el backend (FastAPI + PostgreSQL). Misma interfaz que la demostración.
 *
 * - La sesión es un token que el servidor entrega al ingresar y que viaja en la cabecera
 *   `Authorization`. Se guarda en este navegador para sobrevivir a una recarga; el servidor lo
 *   vence a las pocas horas y lo anula al cerrar sesión.
 * - Las claves solo viajan al servidor, que guarda su huella. Aquí no se guarda ninguna.
 * - Los permisos los decide el servidor en cada consulta: ocultar una pantalla no protege nada.
 */
import { AuthError, cleanProfile, normalizeEmail } from "./auth";
import type { AgencyProfile, AuthApi, AuthErrorCode, Role, Status, StorageLike, User, UserChanges } from "./auth";

export const TOKEN_KEY = "prometheus.sesion.token.v1";

/** Códigos del servidor → los que ya manejan las pantallas. */
const CODES: Record<string, AuthErrorCode> = {
  invalid_credentials: "credenciales",
  temporary_password_expired: "clave-temporal-vencida",
  too_many_attempts: "demasiados-intentos",
  not_authenticated: "sin-sesion",
  session_expired: "sin-sesion",
  forbidden: "sin-permiso",
  not_pending: "no-pendiente",
  invalid_email: "correo-invalido",
  email_exists: "correo-existe",
  password_too_short: "clave-corta",
  password_too_long: "clave-larga",
  password_same_as_temporary: "clave-igual",
  incomplete_profile: "datos-incompletos",
  user_not_found: "no-encontrado",
  cannot_delete_self: "no-borrar-propio",
  last_admin: "ultimo-admin",
  not_allowed_for_admin: "no-admin-temporal",
};

interface RawProfile {
  full_name: string;
  position: string;
  agency: string;
  acronym: string;
  country: string;
}

interface RawUser {
  id: string;
  email: string;
  role: Role;
  status: Status;
  profile: RawProfile | null;
  created_at: string;
  registered_at: string | null;
  temporary_expires_at: string | null;
}

export function toUser(raw: RawUser): User {
  return {
    id: raw.id,
    email: raw.email,
    role: raw.role,
    status: raw.status,
    createdAt: raw.created_at,
    registeredAt: raw.registered_at,
    temporaryExpiresAt: raw.temporary_expires_at,
    profile: raw.profile && {
      fullName: raw.profile.full_name,
      position: raw.profile.position,
      agency: raw.profile.agency,
      acronym: raw.profile.acronym,
      country: raw.profile.country,
    },
  };
}

const toRawProfile = (profile: AgencyProfile): RawProfile => ({
  full_name: profile.fullName,
  position: profile.position,
  agency: profile.agency,
  acronym: profile.acronym,
  country: profile.country,
});

export function createHttpAuth(baseUrl: string, storage: StorageLike, fetcher: typeof fetch = fetch): AuthApi {
  const base = `${baseUrl.replace(/\/+$/, "")}/api/v1`;
  // Se nombra en el aviso de conexión: así se ve enseguida si el servidor está apagado o es otro.
  const host = (() => {
    try {
      return new URL(baseUrl).host;
    } catch {
      return baseUrl;
    }
  })();
  const listeners = new Set<() => void>();
  let token = storage.getItem(TOKEN_KEY);
  let current: User | null = null;
  // Con un token guardado, hasta preguntar al servidor no se sabe si la sesión sigue viva.
  let restoring = Boolean(token);

  const notify = () => listeners.forEach((listener) => listener());

  function setSession(user: User | null, nextToken: string | null) {
    current = user;
    token = nextToken;
    if (nextToken) storage.setItem(TOKEN_KEY, nextToken);
    else storage.removeItem(TOKEN_KEY);
    notify();
  }

  async function call<T>(method: string, path: string, body?: unknown, withToken = true): Promise<T> {
    const sent = withToken ? token : null;
    const headers: Record<string, string> = {};
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (sent) headers.Authorization = `Bearer ${sent}`;
    let response: Response;
    try {
      response = await fetcher(base + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new AuthError(
        "servidor",
        `No se pudo conectar con el servidor de cuentas (${host}). Revisa que esté encendido y tu conexión, e inténtalo de nuevo.`,
      );
    }
    if (response.status === 204) return undefined as T;
    let data: unknown = null;
    try {
      data = await response.json();
    } catch {
      // Respuesta vacía o que no es JSON: se trata abajo según el estado.
    }
    if (response.ok) return data as T;

    const detail = (data as { detail?: { code?: string; message?: string } } | null)?.detail;
    const code = CODES[detail?.code ?? ""] ?? "servidor";
    // La sesión venció o se anuló: se sale, salvo que entretanto ya se haya iniciado otra.
    if (withToken && code === "sin-sesion" && token === sent) setSession(null, null);
    throw new AuthError(code, detail?.message ?? "El servidor no pudo completar la acción. Inténtalo de nuevo.");
  }

  if (token) {
    call<RawUser>("GET", "/auth/me")
      .then((raw) => {
        current = toUser(raw);
      })
      // Si la sesión ya no vale, `call` la limpió; si no hay conexión, se pedirá ingresar de nuevo.
      .catch(() => {})
      .finally(() => {
        restoring = false;
        notify();
      });
  }

  return {
    mode: "servidor",
    session: () => current,
    pending: () => restoring,

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    async login(email, password) {
      const data = await call<{ token: string; user: RawUser }>(
        "POST",
        "/auth/login",
        { email: normalizeEmail(email), password },
        false,
      );
      const user = toUser(data.user);
      restoring = false;
      setSession(user, data.token);
      return user;
    },

    logout() {
      const old = token;
      setSession(null, null);
      // El servidor anula el token; si no responde, igualmente vence solo.
      if (old) {
        fetcher(`${base}/auth/logout`, { method: "POST", headers: { Authorization: `Bearer ${old}` } }).catch(() => {});
      }
    },

    async listUsers() {
      const data = await call<{ users: RawUser[] }>("GET", "/users");
      return data.users.map(toUser);
    },

    async createAgency(email, temporaryPassword) {
      const data = await call<{ user: RawUser }>("POST", "/users", {
        email: normalizeEmail(email),
        temporary_password: temporaryPassword,
      });
      return toUser(data.user);
    },

    async resetTemporaryPassword(userId, temporaryPassword) {
      const data = await call<{ user: RawUser }>("POST", `/users/${encodeURIComponent(userId)}/temporary-password`, {
        temporary_password: temporaryPassword,
      });
      return toUser(data.user);
    },

    async updateUser(userId, changes: UserChanges) {
      const body: { email?: string; profile?: RawProfile } = {};
      if (changes.email !== undefined) body.email = normalizeEmail(changes.email);
      if (changes.profile) body.profile = toRawProfile(cleanProfile(changes.profile));
      const user = toUser(await call<RawUser>("PATCH", `/users/${encodeURIComponent(userId)}`, body));
      // Si el administrador corrige su propia cuenta, la sesión muestra el dato nuevo.
      if (current?.id === user.id) {
        current = user;
        notify();
      }
      return user;
    },

    async deleteUser(userId) {
      await call<void>("DELETE", `/users/${encodeURIComponent(userId)}`);
    },

    async completeRegistration(password, profile) {
      const clean = cleanProfile(profile);
      if (!current) throw new AuthError("sin-sesion", "Inicia sesión con tu clave temporal para registrarte.");
      const pendingUser = current;
      await call<void>("POST", "/auth/registration", { password, profile: toRawProfile(clean) });
      // El servidor cerró todas las sesiones de la cuenta: ahora se ingresa con la clave nueva.
      setSession(null, null);
      return { ...pendingUser, status: "activo", profile: clean, registeredAt: new Date().toISOString(), temporaryExpiresAt: null };
    },

    async resetDemo() {
      throw new AuthError("sin-permiso", "Restablecer las cuentas solo existe en la demostración sin servidor.");
    },
  };
}
