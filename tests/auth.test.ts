import { describe, expect, test } from "bun:test";
import { guard, hashOf, homeFor, parseHash } from "../src/app/routes";
import type { Route } from "../src/app/routes";
import { demoAccounts } from "../src/data/demoAccounts";
import { AuthError, createAuth, generateTemporaryPassword } from "../src/services/auth";
import type { AgencyProfile, StorageLike, User } from "../src/services/auth";

function memoryStorage(): StorageLike {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

const profile: AgencyProfile = {
  fullName: "Miguel Demo",
  position: "Operaciones",
  agency: "Agencia de prueba",
  acronym: "ADP",
  country: "Ecuador",
};

/** Código del error con el que se rechaza una promesa. */
async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "sin error";
  } catch (error) {
    return error instanceof AuthError ? error.code : String(error);
  }
}

describe("cuentas de demostración", () => {
  test("el administrador y la agencia inicial entran con su clave", async () => {
    const auth = createAuth(memoryStorage(), demoAccounts);
    const admin = await auth.login("donald@gmail.com", "12345");
    expect(admin.role).toBe("admin");
    auth.logout();
    const agency = await auth.login(" Liskeyla@Gmail.com ", "12345");
    expect(agency.role).toBe("agencia");
    expect(agency.status).toBe("activo");
    expect(auth.session()?.email).toBe("liskeyla@gmail.com");
  });

  test("clave incorrecta y correo desconocido dan el mismo error", async () => {
    const auth = createAuth(memoryStorage(), demoAccounts);
    expect(await codeOf(auth.login("donald@gmail.com", "otra"))).toBe("credenciales");
    expect(await codeOf(auth.login("nadie@gmail.com", "12345"))).toBe("credenciales");
    expect(auth.session()).toBeNull();
  });

  test("no se guarda la clave tal cual ni se devuelve con la cuenta", async () => {
    const storage = memoryStorage();
    const auth = createAuth(storage, demoAccounts);
    const user = await auth.login("donald@gmail.com", "12345");
    expect(JSON.stringify(user)).not.toContain("hash");
    expect(storage.getItem("prometheus.demo.usuarios.v1")).not.toContain("12345");
  });

  test("solo el administrador ve y crea cuentas", async () => {
    const auth = createAuth(memoryStorage(), demoAccounts);
    expect(await codeOf(auth.listUsers())).toBe("sin-permiso");
    await auth.login("liskeyla@gmail.com", "12345");
    expect(await codeOf(auth.listUsers())).toBe("sin-permiso");
    expect(await codeOf(auth.createAgency("miguel@gmail.com", "TMP-123456"))).toBe("sin-permiso");
    auth.logout();
    await auth.login("donald@gmail.com", "12345");
    expect((await auth.listUsers()).map((u) => u.email)).toEqual(["donald@gmail.com", "liskeyla@gmail.com"]);
  });

  test("el alta valida correo, duplicados y clave temporal", async () => {
    const auth = createAuth(memoryStorage(), demoAccounts);
    await auth.login("donald@gmail.com", "12345");
    expect(await codeOf(auth.createAgency("sin-arroba", "TMP-123456"))).toBe("correo-invalido");
    expect(await codeOf(auth.createAgency("LISKEYLA@gmail.com", "TMP-123456"))).toBe("correo-existe");
    expect(await codeOf(auth.createAgency("miguel@gmail.com", "abc"))).toBe("clave-corta");
  });
});

describe("alta de una agencia: clave temporal, registro e ingreso normal", () => {
  async function createMiguel() {
    const storage = memoryStorage();
    const auth = createAuth(storage, demoAccounts);
    await auth.login("donald@gmail.com", "12345");
    const created = await auth.createAgency("miguel@gmail.com", "TMP-ABC123");
    auth.logout();
    return { auth, storage, created };
  }

  test("la cuenta nace pendiente y entra con la clave temporal", async () => {
    const { auth, created } = await createMiguel();
    expect(created.status).toBe("pendiente");
    expect(created.profile).toBeNull();
    const user = await auth.login("miguel@gmail.com", "TMP-ABC123");
    expect(user.status).toBe("pendiente");
    expect(homeFor(user)).toEqual({ screen: "registro" });
  });

  test("el registro exige datos, una clave válida y distinta de la temporal", async () => {
    const { auth } = await createMiguel();
    await auth.login("miguel@gmail.com", "TMP-ABC123");
    expect(await codeOf(auth.completeRegistration("nueva1", { ...profile, agency: " " }))).toBe("datos-incompletos");
    expect(await codeOf(auth.completeRegistration("abc", profile))).toBe("clave-corta");
    expect(await codeOf(auth.completeRegistration("TMP-ABC123", profile))).toBe("clave-igual");
    expect(auth.session()?.status).toBe("pendiente");
  });

  test("tras registrarse, la clave temporal deja de servir y la nueva funciona", async () => {
    const { auth } = await createMiguel();
    await auth.login("miguel@gmail.com", "TMP-ABC123");
    const registered = await auth.completeRegistration("mi-clave-1", profile);
    expect(registered.status).toBe("activo");
    expect(registered.profile?.agency).toBe("Agencia de prueba");
    expect(homeFor(registered)).toEqual({ screen: "mundo" });
    // La sesión temporal termina: hay que ingresar de nuevo, ya con la clave propia.
    expect(auth.session()).toBeNull();
    expect(await codeOf(auth.login("miguel@gmail.com", "TMP-ABC123"))).toBe("credenciales");
    expect((await auth.login("miguel@gmail.com", "mi-clave-1")).status).toBe("activo");
    expect(await codeOf(auth.completeRegistration("otra12", profile))).toBe("no-pendiente");
  });

  test("las cuentas y la sesión sobreviven a recargar la página", async () => {
    const { auth, storage } = await createMiguel();
    await auth.login("miguel@gmail.com", "TMP-ABC123");
    await auth.completeRegistration("mi-clave-1", profile);
    await auth.login("miguel@gmail.com", "mi-clave-1");
    const reloaded = createAuth(storage, demoAccounts);
    expect(reloaded.session()?.email).toBe("miguel@gmail.com");
    reloaded.logout();
    expect(createAuth(storage, demoAccounts).session()).toBeNull();
    expect((await reloaded.login("miguel@gmail.com", "mi-clave-1")).status).toBe("activo");
  });

  test("el administrador puede dar otra clave temporal; una agencia activa vuelve a quedar pendiente", async () => {
    const { auth, created } = await createMiguel();
    await auth.login("donald@gmail.com", "12345");
    await auth.resetTemporaryPassword(created.id, "TMP-NUEVA1");
    auth.logout();
    expect(await codeOf(auth.login("miguel@gmail.com", "TMP-ABC123"))).toBe("credenciales");
    await auth.login("miguel@gmail.com", "TMP-NUEVA1");
    await auth.completeRegistration("mi-clave-1", profile);
    auth.logout();
    const admin = await auth.login("donald@gmail.com", "12345");
    const reset = await auth.resetTemporaryPassword(created.id, "TMP-OTRA12");
    expect(reset.status).toBe("pendiente");
    // Conserva los datos de la agencia; solo tiene que definir otra clave.
    expect(reset.profile?.agency).toBe("Agencia de prueba");
    expect(await codeOf(auth.resetTemporaryPassword(admin.id, "TMP-OTRA12"))).toBe("no-admin-temporal");
    expect(await codeOf(auth.resetTemporaryPassword(created.id, "corta"))).toBe("clave-corta");
    auth.logout();
    expect(await codeOf(auth.login("miguel@gmail.com", "mi-clave-1"))).toBe("credenciales");
    expect((await auth.login("miguel@gmail.com", "TMP-OTRA12")).status).toBe("pendiente");
  });

  test("el administrador corrige el correo y los datos de una cuenta", async () => {
    const { auth, created } = await createMiguel();
    await auth.login("miguel@gmail.com", "TMP-ABC123");
    await auth.completeRegistration("mi-clave-1", profile);
    expect(await codeOf(auth.updateUser(created.id, { email: "otro@gmail.com" }))).toBe("sin-permiso");
    const admin = await auth.login("donald@gmail.com", "12345");
    expect(await codeOf(auth.updateUser(created.id, { email: "sin-arroba" }))).toBe("correo-invalido");
    expect(await codeOf(auth.updateUser(created.id, { email: "LISKEYLA@gmail.com" }))).toBe("correo-existe");
    expect(await codeOf(auth.updateUser("no-existe", { email: "a@b.co" }))).toBe("no-encontrado");
    expect(await codeOf(auth.updateUser(created.id, { profile: { ...profile, country: " " } }))).toBe("datos-incompletos");
    const updated = await auth.updateUser(created.id, {
      email: " Miguel.Nuevo@Gmail.com ",
      profile: { ...profile, agency: "Agencia corregida" },
    });
    expect(updated.email).toBe("miguel.nuevo@gmail.com");
    expect(updated.profile?.agency).toBe("Agencia corregida");
    // Corregir la cuenta propia actualiza la sesión.
    await auth.updateUser(admin.id, { email: "donald.silva@gmail.com" });
    expect(auth.session()?.email).toBe("donald.silva@gmail.com");
    auth.logout();
    expect((await auth.login("miguel.nuevo@gmail.com", "mi-clave-1")).status).toBe("activo");
  });

  test("el administrador elimina cuentas, pero no la suya ni al último administrador", async () => {
    const { auth, created } = await createMiguel();
    await auth.login("liskeyla@gmail.com", "12345");
    expect(await codeOf(auth.deleteUser(created.id))).toBe("sin-permiso");
    const admin = await auth.login("donald@gmail.com", "12345");
    expect(await codeOf(auth.deleteUser(admin.id))).toBe("no-borrar-propio");
    expect(await codeOf(auth.deleteUser("no-existe"))).toBe("no-encontrado");
    await auth.deleteUser(created.id);
    expect((await auth.listUsers()).map((u) => u.email)).toEqual(["donald@gmail.com", "liskeyla@gmail.com"]);
    auth.logout();
    expect(await codeOf(auth.login("miguel@gmail.com", "TMP-ABC123"))).toBe("credenciales");
  });

  test("restablecer la demo borra las cuentas creadas y conserva al administrador dentro", async () => {
    const { auth } = await createMiguel();
    await auth.login("donald@gmail.com", "12345");
    await auth.resetDemo();
    expect(auth.session()?.email).toBe("donald@gmail.com");
    expect((await auth.listUsers()).map((u) => u.email)).toEqual(["donald@gmail.com", "liskeyla@gmail.com"]);
  });

  test("las claves temporales generadas son válidas y distintas", () => {
    const a = generateTemporaryPassword();
    expect(a).toMatch(/^TMP-[A-Z2-9]{6}$/);
    expect(generateTemporaryPassword()).not.toBe(a);
  });
});

describe("rutas y permisos", () => {
  const user = (role: User["role"], status: User["status"]): User => ({
    id: "x",
    email: "x@x.com",
    role,
    status,
    createdAt: "",
    registeredAt: null,
    profile: null,
  });
  const admin = user("admin", "activo");
  const agency = user("agencia", "activo");
  const pending = user("agencia", "pendiente");

  test("cada dirección vuelve a su pantalla", () => {
    for (const hash of ["#ingresar", "#registro", "#admin", "#mundo", "#turnos"]) {
      expect(hashOf(parseHash(hash))).toBe(hash);
    }
    expect(parseHash("")).toEqual({ screen: "landing" });
    expect(parseHash("#luna")).toEqual({ screen: "landing" });
  });

  test("sin sesión, las pantallas privadas llevan al ingreso", () => {
    for (const screen of ["admin", "mundo", "registro"] as const) {
      expect(guard({ screen }, null)).toEqual({ screen: "login" });
    }
    // El mundo interactivo pide sesión: sin ella solo se ven la portada y el ingreso.
    const world: Route = { screen: "mundo" };
    expect(guard(world, null)).toEqual({ screen: "login" });
    expect(guard(world, agency)).toBe(world);
    expect(guard(world, admin)).toBe(world);
    expect(guard(world, pending)).toEqual({ screen: "registro" });
    // El explorador antiguo de datos sintéticos ya no existe: sus direcciones llevan a la portada.
    for (const hash of ["#explorador", "#ranking", "#riesgos", "#economia"]) {
      expect(parseHash(hash)).toEqual({ screen: "landing" });
    }
    expect(guard({ screen: "landing" }, null)).toEqual({ screen: "landing" });
    expect(guard({ screen: "login" }, null)).toEqual({ screen: "login" });
  });

  test("la agencia no entra al panel del administrador", () => {
    expect(guard({ screen: "admin" }, agency)).toEqual({ screen: "mundo" });
    expect(guard({ screen: "admin" }, admin)).toEqual({ screen: "admin" });
    expect(guard({ screen: "mundo" }, admin)).toEqual({ screen: "mundo" });
  });

  test("una cuenta pendiente solo puede completar su registro", () => {
    expect(guard({ screen: "mundo" }, pending)).toEqual({ screen: "registro" });
    expect(guard({ screen: "admin" }, pending)).toEqual({ screen: "registro" });
    expect(guard({ screen: "registro" }, agency)).toEqual({ screen: "mundo" });
  });

  test("con sesión, la pantalla de ingreso lleva a la pantalla propia", () => {
    expect(guard({ screen: "login" }, admin)).toEqual({ screen: "admin" });
    expect(guard({ screen: "login" }, agency)).toEqual({ screen: "mundo" });
    expect(guard({ screen: "login" }, pending)).toEqual({ screen: "registro" });
  });
});
