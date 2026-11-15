import { describe, expect, test } from "bun:test";
import { AuthError } from "../src/services/auth";
import type { StorageLike } from "../src/services/auth";
import { TOKEN_KEY, createHttpAuth } from "../src/services/authHttp";

function memoryStorage(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "sin error";
  } catch (error) {
    return error instanceof AuthError ? error.code : String(error);
  }
}

const profile = { fullName: "Miguel Ruiz", position: "Director", agency: "Agencia de prueba", acronym: "AP", country: "Ecuador" };

interface Account {
  id: string;
  email: string;
  role: "admin" | "agencia";
  status: "pendiente" | "activo";
  password: string;
  profile: Record<string, string> | null;
}

/**
 * Servidor simulado con el contrato del backend: mismas rutas, estados y códigos de error.
 * Guarda las claves tal cual porque solo existe dentro de la prueba.
 */
function fakeServer() {
  const accounts: Account[] = [
    { id: "a1", email: "donald@gmail.com", role: "admin", status: "activo", password: "clave-admin", profile: null },
  ];
  const sessions = new Map<string, string>();
  const calls: { method: string; path: string; authorization: string | null; body: unknown }[] = [];
  let next = 1;
  let online = true;
  let failures = 0;

  const out = (a: Account) => ({
    id: a.id,
    email: a.email,
    role: a.role,
    status: a.status,
    profile: a.profile,
    created_at: "2026-11-14T10:00:00Z",
    registered_at: a.status === "activo" && a.role === "agencia" ? "2026-11-14T11:00:00Z" : null,
    temporary_expires_at: a.status === "pendiente" ? "2026-11-21T10:00:00Z" : null,
  });
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
  const fail = (status: number, code: string) => json(status, { detail: { code, message: `mensaje de ${code}` } });

  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (!online) throw new TypeError("sin red");
    const url = new URL(String(input));
    const path = url.pathname.replace("/api/v1", "");
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    const authorization = headers.get("Authorization");
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path, authorization, body });

    if (method === "POST" && path === "/auth/login") {
      if (failures >= 5) return fail(429, "too_many_attempts");
      const account = accounts.find((a) => a.email === body.email && a.password === body.password);
      if (!account) {
        failures += 1;
        return fail(401, "invalid_credentials");
      }
      failures = 0;
      const token = `token-${next++}`;
      sessions.set(token, account.id);
      return json(200, { token, expires_at: "2026-11-15T10:00:00Z", user: out(account) });
    }

    const token = authorization?.replace("Bearer ", "") ?? "";
    const me = accounts.find((a) => a.id === sessions.get(token));
    if (!me) return fail(401, "not_authenticated");

    if (method === "GET" && path === "/auth/me") return json(200, out(me));
    if (method === "POST" && path === "/auth/logout") {
      sessions.delete(token);
      return new Response(null, { status: 204 });
    }
    if (method === "POST" && path === "/auth/registration") {
      if (me.status !== "pendiente") return fail(409, "not_pending");
      if (body.password.length < 8) return fail(422, "password_too_short");
      if (body.password === me.password) return fail(422, "password_same_as_temporary");
      Object.assign(me, { status: "activo", password: body.password, profile: body.profile });
      for (const [key, id] of sessions) if (id === me.id) sessions.delete(key);
      return new Response(null, { status: 204 });
    }

    if (me.role !== "admin" || me.status !== "activo") return fail(403, "forbidden");
    if (method === "GET" && path === "/users") return json(200, { users: accounts.map(out) });
    if (method === "POST" && path === "/users") {
      if (accounts.some((a) => a.email === body.email)) return fail(409, "email_exists");
      const account: Account = { id: `u${next++}`, email: body.email, role: "agencia", status: "pendiente", password: body.temporary_password, profile: null };
      accounts.push(account);
      return json(201, { user: out(account), temporary_password: body.temporary_password });
    }
    const [, , id, action] = path.split("/");
    const target = accounts.find((a) => a.id === id);
    if (!target) return fail(404, "user_not_found");
    if (method === "PATCH") {
      if (body.email) target.email = body.email;
      if (body.profile) target.profile = body.profile;
      return json(200, out(target));
    }
    if (method === "DELETE") {
      if (target.id === me.id) return fail(409, "cannot_delete_self");
      accounts.splice(accounts.indexOf(target), 1);
      return new Response(null, { status: 204 });
    }
    if (method === "POST" && action === "temporary-password") {
      if (target.role === "admin") return fail(409, "not_allowed_for_admin");
      Object.assign(target, { status: "pendiente", password: body.temporary_password });
      return json(200, { user: out(target), temporary_password: body.temporary_password });
    }
    return fail(418, "codigo_que_el_cliente_no_conoce");
  }) as unknown as typeof fetch;

  return { fetcher, accounts, sessions, calls, setOnline: (value: boolean) => (online = value) };
}

const BASE = "https://api.ejemplo.test/";
/** Deja terminar la comprobación de la sesión guardada. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

describe("cuentas en el servidor", () => {
  test("ingresar guarda el token y lo envía en las consultas siguientes", async () => {
    const server = fakeServer();
    const storage = memoryStorage();
    const auth = createHttpAuth(BASE, storage, server.fetcher);
    expect(auth.mode).toBe("servidor");
    expect(auth.session()).toBeNull();
    expect(auth.pending()).toBe(false);

    const user = await auth.login(" Donald@Gmail.com ", "clave-admin");
    expect(user).toMatchObject({ email: "donald@gmail.com", role: "admin", status: "activo", profile: null });
    expect(auth.session()).toBe(user);
    expect(storage.getItem(TOKEN_KEY)).toBe("token-1");
    // La clave solo viaja en el ingreso y nunca se guarda en el navegador.
    expect(server.calls[0]).toMatchObject({ path: "/auth/login", authorization: null, body: { email: "donald@gmail.com" } });
    expect([...storage.data.values()].join(" ")).not.toContain("clave-admin");

    await auth.listUsers();
    expect(server.calls.at(-1)).toMatchObject({ method: "GET", path: "/users", authorization: "Bearer token-1" });
  });

  test("al recargar, la sesión guardada se comprueba con el servidor", async () => {
    const server = fakeServer();
    const storage = memoryStorage();
    await createHttpAuth(BASE, storage, server.fetcher).login("donald@gmail.com", "clave-admin");

    const reloaded = createHttpAuth(BASE, storage, server.fetcher);
    let notified = 0;
    reloaded.subscribe(() => notified++);
    expect(reloaded.pending()).toBe(true);
    expect(reloaded.session()).toBeNull();
    await settle();
    expect(reloaded.pending()).toBe(false);
    expect(reloaded.session()?.email).toBe("donald@gmail.com");
    expect(notified).toBeGreaterThan(0);
  });

  test("un token que ya no vale se descarta y hay que ingresar de nuevo", async () => {
    const server = fakeServer();
    const storage = memoryStorage();
    storage.setItem(TOKEN_KEY, "token-viejo");
    const auth = createHttpAuth(BASE, storage, server.fetcher);
    await settle();
    expect(auth.pending()).toBe(false);
    expect(auth.session()).toBeNull();
    expect(storage.getItem(TOKEN_KEY)).toBeNull();
  });

  test("sin conexión no se queda esperando: pide ingresar y avisa del fallo", async () => {
    const server = fakeServer();
    const storage = memoryStorage();
    storage.setItem(TOKEN_KEY, "token-1");
    server.setOnline(false);
    const auth = createHttpAuth(BASE, storage, server.fetcher);
    await settle();
    expect(auth.pending()).toBe(false);
    expect(auth.session()).toBeNull();
    expect(await codeOf(auth.login("donald@gmail.com", "clave-admin"))).toBe("servidor");
    // El aviso nombra el servidor: así se nota enseguida si está apagado o la dirección es otra.
    const failure = await auth.login("donald@gmail.com", "clave-admin").catch((error: AuthError) => error);
    expect((failure as AuthError).message).toContain("api.ejemplo.test");
  });

  test("los errores del servidor llegan con el código que entienden las pantallas", async () => {
    const server = fakeServer();
    const auth = createHttpAuth(BASE, memoryStorage(), server.fetcher);
    expect(await codeOf(auth.login("donald@gmail.com", "mala"))).toBe("credenciales");
    expect(await codeOf(auth.login("nadie@gmail.com", "clave-admin"))).toBe("credenciales");
    for (let i = 0; i < 3; i++) await codeOf(auth.login("donald@gmail.com", "mala"));
    expect(await codeOf(auth.login("donald@gmail.com", "clave-admin"))).toBe("demasiados-intentos");
    expect(auth.session()).toBeNull();
    try {
      await auth.login("donald@gmail.com", "clave-admin");
    } catch (error) {
      expect((error as AuthError).message).toBe("mensaje de too_many_attempts");
    }
  });

  test("alta de una agencia: clave temporal, registro e ingreso normal", async () => {
    const server = fakeServer();
    const auth = createHttpAuth(BASE, memoryStorage(), server.fetcher);
    await auth.login("donald@gmail.com", "clave-admin");
    const created = await auth.createAgency("Miguel@gmail.com", "TMP-ABC123");
    expect(created).toMatchObject({ email: "miguel@gmail.com", status: "pendiente", profile: null, temporaryExpiresAt: "2026-11-21T10:00:00Z" });
    expect(await codeOf(auth.createAgency("miguel@gmail.com", "TMP-ABC123"))).toBe("correo-existe");
    auth.logout();
    expect(server.calls.at(-1)).toMatchObject({ path: "/auth/logout", authorization: "Bearer token-1" });
    expect(server.sessions.size).toBe(0);

    const pending = await auth.login("miguel@gmail.com", "TMP-ABC123");
    expect(pending.status).toBe("pendiente");
    expect(await codeOf(auth.listUsers())).toBe("sin-permiso");
    // Los datos incompletos se detectan antes de consultar al servidor.
    const before = server.calls.length;
    expect(await codeOf(auth.completeRegistration("mi-clave-1", { ...profile, agency: " " }))).toBe("datos-incompletos");
    expect(server.calls.length).toBe(before);
    expect(await codeOf(auth.completeRegistration("corta", profile))).toBe("clave-corta");
    expect(await codeOf(auth.completeRegistration("TMP-ABC123", profile))).toBe("clave-igual");

    const registered = await auth.completeRegistration("mi-clave-1", profile);
    expect(registered).toMatchObject({ status: "activo", profile: { agency: "Agencia de prueba" } });
    expect(server.calls.at(-1)?.body).toMatchObject({ profile: { full_name: "Miguel Ruiz", agency: "Agencia de prueba" } });
    // La sesión temporal termina: se ingresa de nuevo con la clave propia.
    expect(auth.session()).toBeNull();
    expect(await codeOf(auth.login("miguel@gmail.com", "TMP-ABC123"))).toBe("credenciales");
    const active = await auth.login("miguel@gmail.com", "mi-clave-1");
    expect(active).toMatchObject({ status: "activo", profile: { fullName: "Miguel Ruiz", country: "Ecuador" } });
  });

  test("el administrador corrige, restablece y elimina cuentas", async () => {
    const server = fakeServer();
    const auth = createHttpAuth(BASE, memoryStorage(), server.fetcher);
    const admin = await auth.login("donald@gmail.com", "clave-admin");
    const created = await auth.createAgency("miguel@gmail.com", "TMP-ABC123");

    const updated = await auth.updateUser(created.id, { email: " Nuevo@Gmail.com ", profile });
    expect(updated).toMatchObject({ email: "nuevo@gmail.com", profile: { fullName: "Miguel Ruiz" } });
    expect(server.calls.at(-1)).toMatchObject({ method: "PATCH", body: { email: "nuevo@gmail.com", profile: { full_name: "Miguel Ruiz" } } });

    const reset = await auth.resetTemporaryPassword(created.id, "TMP-OTRA12");
    expect(reset.status).toBe("pendiente");
    expect(await codeOf(auth.resetTemporaryPassword(admin.id, "TMP-OTRA12"))).toBe("no-admin-temporal");

    expect(await codeOf(auth.deleteUser(admin.id))).toBe("no-borrar-propio");
    expect(await codeOf(auth.deleteUser("no-existe"))).toBe("no-encontrado");
    await auth.deleteUser(created.id);
    expect((await auth.listUsers()).map((u) => u.email)).toEqual(["donald@gmail.com"]);

    // Corregir la cuenta propia actualiza la sesión.
    await auth.updateUser(admin.id, { email: "donald.silva@gmail.com" });
    expect(auth.session()?.email).toBe("donald.silva@gmail.com");
    expect(await codeOf(auth.resetDemo())).toBe("sin-permiso");
  });

  test("si la sesión vence mientras se usa la aplicación, se sale y se avisa", async () => {
    const server = fakeServer();
    const storage = memoryStorage();
    const auth = createHttpAuth(BASE, storage, server.fetcher);
    await auth.login("donald@gmail.com", "clave-admin");
    let notified = 0;
    auth.subscribe(() => notified++);
    server.sessions.clear();
    expect(await codeOf(auth.listUsers())).toBe("sin-sesion");
    expect(auth.session()).toBeNull();
    expect(storage.getItem(TOKEN_KEY)).toBeNull();
    expect(notified).toBe(1);
  });

  test("un código desconocido o una respuesta rara no rompen la pantalla", async () => {
    const odd = (async () => new Response("<html>502</html>", { status: 502 })) as unknown as typeof fetch;
    const auth = createHttpAuth(BASE, memoryStorage(), odd);
    expect(await codeOf(auth.login("donald@gmail.com", "clave-admin"))).toBe("servidor");
  });
});
