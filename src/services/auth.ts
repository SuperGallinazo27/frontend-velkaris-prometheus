/**
 * Cuentas y sesión: la interfaz que usan las pantallas (`AuthApi`) y su versión de DEMOSTRACIÓN,
 * sin servidor ni base de datos.
 *
 * La versión real habla con el backend y está en `authHttp.ts`; `session.ts` elige cuál se usa.
 * En la demostración todo se guarda en el almacenamiento del navegador: cualquiera con acceso a
 * este equipo puede leerlo o modificarlo, así que no es un sistema de seguridad real.
 */

export type Role = "admin" | "agencia";
/** `pendiente`: creado por el administrador, aún con clave temporal y sin datos de la agencia. */
export type Status = "pendiente" | "activo";

export interface AgencyProfile {
  fullName: string;
  position: string;
  agency: string;
  acronym: string;
  country: string;
}

export interface User {
  id: string;
  email: string;
  role: Role;
  status: Status;
  createdAt: string;
  registeredAt: string | null;
  profile: AgencyProfile | null;
  /** Hasta cuándo sirve la clave temporal. Solo lo informa el servidor. */
  temporaryExpiresAt?: string | null;
}

/** Lo que el administrador puede corregir de una cuenta. */
export interface UserChanges {
  email?: string;
  profile?: AgencyProfile;
}

/** Cuenta inicial: se crea la primera vez que se usa el servicio en un navegador. */
export interface SeedAccount {
  email: string;
  role: Role;
  password: string;
  profile: AgencyProfile | null;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type AuthErrorCode =
  | "credenciales"
  | "sin-permiso"
  | "correo-invalido"
  | "correo-existe"
  | "clave-corta"
  | "clave-igual"
  | "no-pendiente"
  | "datos-incompletos"
  | "no-encontrado"
  | "no-borrar-propio"
  | "ultimo-admin"
  | "no-admin-temporal"
  | "clave-larga"
  | "clave-temporal-vencida"
  | "demasiados-intentos"
  | "sin-sesion"
  | "servidor";

export class AuthError extends Error {
  code: AuthErrorCode;
  constructor(code: AuthErrorCode, message: string) {
    super(message);
    this.name = "AuthError";
    this.code = code;
  }
}

export interface AuthApi {
  /** `servidor`: cuentas en la base de datos del backend. `local`: demostración en este navegador. */
  readonly mode: "local" | "servidor";
  /** Sesión actual; la referencia no cambia mientras la sesión sea la misma. */
  session(): User | null;
  /** true mientras se comprueba con el servidor una sesión guardada: aún no se sabe si hay sesión. */
  pending(): boolean;
  subscribe(listener: () => void): () => void;
  login(email: string, password: string): Promise<User>;
  logout(): void;
  /** Solo administrador. */
  listUsers(): Promise<User[]>;
  /** Solo administrador: abre el acceso de una agencia con una clave temporal. */
  createAgency(email: string, temporaryPassword: string): Promise<User>;
  /**
   * Solo administrador: da una clave temporal nueva a una agencia. Si ya había completado su
   * registro, vuelve a quedar pendiente (conserva sus datos) y tendrá que definir otra clave.
   */
  resetTemporaryPassword(userId: string, temporaryPassword: string): Promise<User>;
  /** Solo administrador: corrige el correo o los datos de la agencia. */
  updateUser(userId: string, changes: UserChanges): Promise<User>;
  /** Solo administrador: elimina una cuenta. No puede eliminarse a sí mismo ni al último administrador. */
  deleteUser(userId: string): Promise<void>;
  /**
   * La cuenta pendiente con sesión iniciada define su clave y los datos de su agencia.
   * Al terminar se cierra esa sesión temporal: desde ahí se ingresa de forma normal con la clave nueva.
   */
  completeRegistration(password: string, profile: AgencyProfile): Promise<User>;
  /** Solo administrador y solo en la demostración: vuelve a las cuentas iniciales. */
  resetDemo(): Promise<void>;
}

/** Longitud mínima de una clave nueva. El servidor aplica la misma regla. */
export const MIN_PASSWORD_LENGTH = 8;

/** Deja los datos de la agencia sin espacios sobrantes y comprueba los obligatorios. */
export function cleanProfile(profile: AgencyProfile): AgencyProfile {
  const clean: AgencyProfile = {
    fullName: profile.fullName.trim(),
    position: profile.position.trim(),
    agency: profile.agency.trim(),
    acronym: profile.acronym.trim(),
    country: profile.country.trim(),
  };
  if (!clean.fullName || !clean.agency || !clean.country) {
    throw new AuthError("datos-incompletos", "Completa tu nombre, la agencia y el país.");
  }
  return clean;
}

const USERS_KEY = "prometheus.demo.usuarios.v1";
const SESSION_KEY = "prometheus.demo.sesion.v1";

interface StoredUser extends User {
  salt: string;
  hash: string;
}

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

export const isValidEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

function randomText(length: number, alphabet: string): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

/** Clave temporal fácil de dictar: sin caracteres que se confundan entre sí. */
export function generateTemporaryPassword(): string {
  return `TMP-${randomText(6, "ABCDEFGHJKMNPQRSTUVWXYZ23456789")}`;
}

/**
 * Huella de la clave. Evita guardar la clave tal cual en el navegador, pero no convierte esto en
 * un sistema seguro. Fuera de un contexto seguro (https o localhost) el navegador no ofrece
 * SHA-256 y se usa una huella simple.
 */
async function digest(salt: string, password: string): Promise<string> {
  const text = `${salt}:${password}`;
  if (globalThis.crypto?.subtle) {
    const buffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, "0")).join("");
  }
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    a = Math.imul(a ^ text.charCodeAt(i), 0x01000193);
    b = Math.imul(b + text.charCodeAt(i), 0x85ebca6b) ^ (a >>> 13);
  }
  return `simple-${(a >>> 0).toString(16)}${(b >>> 0).toString(16)}`;
}

function toUser(stored: StoredUser): User {
  const { salt: _salt, hash: _hash, ...user } = stored;
  return user;
}

export function createAuth(
  storage: StorageLike,
  seed: readonly SeedAccount[],
  now: () => Date = () => new Date(),
): AuthApi {
  const listeners = new Set<() => void>();
  let users: StoredUser[] | null = null;
  let current: User | null = null;
  let seeding: Promise<void> | null = null;

  function read(): StoredUser[] | null {
    try {
      const raw = storage.getItem(USERS_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : null;
      return Array.isArray(parsed) ? (parsed as StoredUser[]) : null;
    } catch {
      return null;
    }
  }

  function write(next: StoredUser[]) {
    users = next;
    storage.setItem(USERS_KEY, JSON.stringify(next));
  }

  function setSession(user: User | null) {
    current = user;
    if (user) storage.setItem(SESSION_KEY, user.id);
    else storage.removeItem(SESSION_KEY);
    listeners.forEach((listener) => listener());
  }

  async function makeStored(account: SeedAccount, status: Status): Promise<StoredUser> {
    const salt = randomText(16, "abcdefghijklmnopqrstuvwxyz0123456789");
    const stamp = now().toISOString();
    return {
      id: randomText(12, "abcdefghijklmnopqrstuvwxyz0123456789"),
      email: normalizeEmail(account.email),
      role: account.role,
      status,
      createdAt: stamp,
      registeredAt: status === "activo" ? stamp : null,
      profile: account.profile,
      salt,
      hash: await digest(salt, account.password),
    };
  }

  /** Carga las cuentas guardadas o crea las iniciales la primera vez. */
  function ready(): Promise<void> {
    if (users) return Promise.resolve();
    seeding ??= (async () => {
      const saved = read();
      if (saved) users = saved;
      else write(await Promise.all(seed.map((account) => makeStored(account, "activo"))));
      seeding = null;
    })();
    return seeding;
  }

  function requireAdmin() {
    if (current?.role !== "admin") {
      throw new AuthError("sin-permiso", "Solo el administrador puede hacer esto.");
    }
  }

  function requirePassword(password: string) {
    if (password.length < MIN_PASSWORD_LENGTH) {
      throw new AuthError("clave-corta", `La clave necesita al menos ${MIN_PASSWORD_LENGTH} caracteres.`);
    }
  }

  // Recupera la sesión guardada, si sus cuentas siguen existiendo.
  const savedUsers = read();
  if (savedUsers) {
    users = savedUsers;
    const id = storage.getItem(SESSION_KEY);
    const match = id ? savedUsers.find((u) => u.id === id) : undefined;
    current = match ? toUser(match) : null;
  }

  return {
    mode: "local",
    session: () => current,
    pending: () => false,

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    async login(email, password) {
      await ready();
      const stored = users!.find((u) => u.email === normalizeEmail(email));
      // Mismo mensaje exista o no la cuenta, para no revelar qué correos están registrados.
      if (!stored || (await digest(stored.salt, password)) !== stored.hash) {
        throw new AuthError("credenciales", "Correo o clave incorrectos.");
      }
      const user = toUser(stored);
      setSession(user);
      return user;
    },

    logout() {
      setSession(null);
    },

    async listUsers() {
      await ready();
      requireAdmin();
      return users!.map(toUser);
    },

    async createAgency(email, temporaryPassword) {
      await ready();
      requireAdmin();
      const normalized = normalizeEmail(email);
      if (!isValidEmail(normalized)) throw new AuthError("correo-invalido", "Escribe un correo válido.");
      if (users!.some((u) => u.email === normalized)) {
        throw new AuthError("correo-existe", "Ya existe una cuenta con ese correo.");
      }
      requirePassword(temporaryPassword);
      const stored = await makeStored(
        { email: normalized, role: "agencia", password: temporaryPassword, profile: null },
        "pendiente",
      );
      write([...users!, stored]);
      return toUser(stored);
    },

    async resetTemporaryPassword(userId, temporaryPassword) {
      await ready();
      requireAdmin();
      const stored = users!.find((u) => u.id === userId);
      if (!stored) throw new AuthError("no-encontrado", "Esa cuenta ya no existe.");
      if (stored.role === "admin") {
        throw new AuthError("no-admin-temporal", "La clave temporal es solo para cuentas de agencia.");
      }
      requirePassword(temporaryPassword);
      const updated: StoredUser = {
        ...stored,
        status: "pendiente",
        hash: await digest(stored.salt, temporaryPassword),
      };
      write(users!.map((u) => (u.id === userId ? updated : u)));
      return toUser(updated);
    },

    async updateUser(userId, changes) {
      await ready();
      requireAdmin();
      const stored = users!.find((u) => u.id === userId);
      if (!stored) throw new AuthError("no-encontrado", "Esa cuenta ya no existe.");
      const updated: StoredUser = { ...stored };
      if (changes.email !== undefined) {
        const email = normalizeEmail(changes.email);
        if (!isValidEmail(email)) throw new AuthError("correo-invalido", "Escribe un correo válido.");
        if (users!.some((u) => u.id !== userId && u.email === email)) {
          throw new AuthError("correo-existe", "Ya existe una cuenta con ese correo.");
        }
        updated.email = email;
      }
      if (changes.profile) updated.profile = cleanProfile(changes.profile);
      write(users!.map((u) => (u.id === userId ? updated : u)));
      // Si el administrador corrige su propia cuenta, la sesión muestra el dato nuevo.
      if (current?.id === userId) setSession(toUser(updated));
      return toUser(updated);
    },

    async deleteUser(userId) {
      await ready();
      requireAdmin();
      const stored = users!.find((u) => u.id === userId);
      if (!stored) throw new AuthError("no-encontrado", "Esa cuenta ya no existe.");
      if (stored.id === current!.id) {
        throw new AuthError("no-borrar-propio", "No puedes eliminar tu propia cuenta.");
      }
      if (stored.role === "admin" && users!.filter((u) => u.role === "admin").length === 1) {
        throw new AuthError("ultimo-admin", "Tiene que quedar al menos un administrador.");
      }
      write(users!.filter((u) => u.id !== userId));
    },

    async completeRegistration(password, profile) {
      await ready();
      const stored = current ? users!.find((u) => u.id === current!.id) : undefined;
      if (!stored) throw new AuthError("sin-permiso", "Inicia sesión con tu clave temporal para registrarte.");
      if (stored.status !== "pendiente") {
        throw new AuthError("no-pendiente", "Esta cuenta ya completó su registro.");
      }
      const clean = cleanProfile(profile);
      requirePassword(password);
      const hash = await digest(stored.salt, password);
      if (hash === stored.hash) {
        throw new AuthError("clave-igual", "La nueva clave debe ser distinta de la temporal.");
      }
      const updated: StoredUser = {
        ...stored,
        hash,
        status: "activo",
        registeredAt: now().toISOString(),
        profile: clean,
      };
      write(users!.map((u) => (u.id === updated.id ? updated : u)));
      setSession(null);
      return toUser(updated);
    },

    async resetDemo() {
      await ready();
      requireAdmin();
      const adminEmail = current!.email;
      storage.removeItem(USERS_KEY);
      users = null;
      await ready();
      // El administrador sigue dentro si su cuenta es una de las iniciales.
      const admin = users!.find((u: StoredUser) => u.email === adminEmail);
      setSession(admin ? toUser(admin) : null);
    },
  };
}
