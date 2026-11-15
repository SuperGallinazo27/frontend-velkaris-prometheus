import { useEffect, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import { AccountBar } from "../../components/AccountBar";
import { CountrySelect } from "../../components/CountrySelect";
import { AuthError, MIN_PASSWORD_LENGTH, generateTemporaryPassword } from "../../services/auth";
import type { AgencyProfile, User, UserChanges } from "../../services/auth";
import { displayCountry, matchCountry } from "../../services/countries";
import { auth } from "../../services/session";
import { AdminLugares } from "./AdminLugares";
import { AdminTurnos } from "./AdminTurnos";
import "./admin.css";

const formatDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString("es", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const messageOf = (cause: unknown) =>
  cause instanceof AuthError ? cause.message : "No se pudo completar la acción. Inténtalo de nuevo.";

/** Acceso recién abierto: la clave temporal solo se muestra aquí, no se guarda a la vista. */
interface Issued {
  email: string;
  password: string;
}

/** Lo que se está corrigiendo de una cuenta. */
interface Draft {
  user: User;
  email: string;
  profile: AgencyProfile | null;
}

/** Acción que pide confirmación antes de ejecutarse, sobre una fila de la tabla. */
interface Confirm {
  userId: string;
  action: "eliminar" | "restablecer";
}

const TABS = [
  { id: "cuentas", name: "Cuentas", title: "Usuarios" },
  { id: "turnos", name: "Turnos", title: "Turnos" },
  { id: "lugares", name: "Lugares", title: "Lugares" },
] as const;
type Tab = (typeof TABS)[number]["id"];

/**
 * Panel del administrador, en tres pestañas: las cuentas de las agencias, los turnos que han
 * reservado y los lugares (qué se puede reservar y por qué).
 */
export function Admin({ user }: { user: User }) {
  const [tab, setTab] = useState<Tab>("cuentas");
  const tabsRef = useRef<HTMLDivElement>(null);
  const [users, setUsers] = useState<User[] | null>(null);
  const [email, setEmail] = useState("");
  const [temporary, setTemporary] = useState(generateTemporaryPassword);
  const [error, setError] = useState("");
  const [issued, setIssued] = useState<Issued | null>(null);
  const [copied, setCopied] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [busy, setBusy] = useState(false);
  const server = auth.mode === "servidor";

  const refresh = () => auth.listUsers().then(setUsers);

  useEffect(() => {
    let cancelled = false;
    auth
      .listUsers()
      .then((list) => !cancelled && setUsers(list))
      .catch((cause) => !cancelled && setError(messageOf(cause)));
    return () => {
      cancelled = true;
    };
  }, []);

  /** Ejecuta una acción del administrador y vuelve a cargar la lista. Devuelve si salió bien. */
  async function run(action: () => Promise<Issued | null>): Promise<boolean> {
    setBusy(true);
    setError("");
    setConfirm(null);
    let done = false;
    try {
      const result = await action();
      setIssued(result);
      setCopied(false);
      await refresh();
      done = true;
    } catch (cause) {
      setError(messageOf(cause));
    }
    setBusy(false);
    return done;
  }

  function create(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      const created = await auth.createAgency(email, temporary);
      setEmail("");
      setTemporary(generateTemporaryPassword());
      return { email: created.email, password: temporary };
    });
  }

  /** Clave temporal nueva. Una agencia activa vuelve a quedar pendiente y define otra clave. */
  function reissue(target: User) {
    const password = generateTemporaryPassword();
    void run(async () => {
      await auth.resetTemporaryPassword(target.id, password);
      return { email: target.email, password };
    });
  }

  function remove(target: User) {
    void run(async () => {
      await auth.deleteUser(target.id);
      if (draft?.user.id === target.id) setDraft(null);
      return null;
    });
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!draft) return;
    const changes: UserChanges = {};
    if (draft.email.trim().toLowerCase() !== draft.user.email) changes.email = draft.email;
    if (draft.profile) changes.profile = draft.profile;
    const saved = await run(async () => {
      await auth.updateUser(draft.user.id, changes);
      return null;
    });
    if (saved) setDraft(null);
  }

  function resetDemo() {
    setConfirmReset(false);
    void run(async () => {
      await auth.resetDemo();
      return null;
    });
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  const profileField = (key: keyof AgencyProfile) => ({
    value: draft?.profile?.[key] ?? "",
    onChange: (e: { target: { value: string } }) =>
      setDraft((d) => (d?.profile ? { ...d, profile: { ...d.profile, [key]: e.target.value } } : d)),
  });

  const pending = users?.filter((u) => u.status === "pendiente").length ?? 0;

  /** Las flechas cambian de pestaña, como en cualquier grupo de pestañas. */
  function onTabKey(event: KeyboardEvent) {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const index = (TABS.findIndex((item) => item.id === tab) + step + TABS.length) % TABS.length;
    setTab(TABS[index].id);
    tabsRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[index]?.focus();
  }

  return (
    <div className="nocturno claro admin">
      <AccountBar user={user} current="admin" />
      <main className="admin-caja">
        <span className="nc-eyebrow">Administración</span>
        <h1 className="nc-titulo">{TABS.find((item) => item.id === tab)!.title}</h1>
        <div className="admin-pestanas" role="tablist" aria-label="Administración" ref={tabsRef} onKeyDown={onTabKey}>
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              id={`admin-pestana-${item.id}`}
              aria-selected={tab === item.id}
              aria-controls="admin-panel"
              tabIndex={tab === item.id ? 0 : -1}
              onClick={() => setTab(item.id)}
            >
              {item.name}
            </button>
          ))}
        </div>

        <div className="admin-panel" role="tabpanel" id="admin-panel" aria-labelledby={`admin-pestana-${tab}`}>
          {tab === "turnos" && <AdminTurnos />}
          {tab === "lugares" && <AdminLugares />}
          {tab === "cuentas" && (
            <>
            <p className="nc-texto-2 admin-intro">
              Abre el acceso de una agencia con su correo y una clave temporal. La agencia entra con esa clave, completa
              su registro y desde entonces ingresa con su propia clave.
            </p>

            <section className="admin-alta nc-tarjeta" aria-labelledby="admin-t-alta">
              <h2 id="admin-t-alta">Crear acceso de agencia</h2>
              <form onSubmit={create} noValidate>
                <label className="nc-campo">
                  <span>Correo de la agencia</span>
                  <input
                    id="admin-correo"
                    type="email"
                    required
                    autoComplete="off"
                    placeholder="nombre@agencia.org"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </label>
                <label className="nc-campo">
                  <span>
                    Clave temporal <small>(mínimo {MIN_PASSWORD_LENGTH} caracteres)</small>
                  </span>
                  <input
                    id="admin-clave"
                    required
                    autoComplete="off"
                    spellCheck={false}
                    value={temporary}
                    onChange={(e) => setTemporary(e.target.value)}
                  />
                </label>
                <button
                  className="nc-btn secundario"
                  type="button"
                  onClick={() => setTemporary(generateTemporaryPassword())}
                >
                  Generar otra
                </button>
                <button className="nc-btn primario" type="submit" disabled={busy || !email || !temporary}>
                  Crear acceso
                </button>
              </form>
              {error && (
                <p className="nc-aviso error" role="alert">
                  {error}
                </p>
              )}
              {issued && (
                <div className="nc-aviso ok admin-emitida" role="status">
                  <div>
                    Clave temporal para <strong>{issued.email}</strong>. Entrégasela por un canal seguro; solo se muestra
                    ahora.
                    <code>{issued.password}</code>
                  </div>
                  <button className="nc-btn secundario compacto" type="button" onClick={() => copy(issued.password)}>
                    {copied ? "Copiada" : "Copiar clave"}
                  </button>
                </div>
              )}
            </section>

            {draft && (
              <section className="admin-edicion nc-tarjeta" aria-labelledby="admin-t-edicion">
                <h2 id="admin-t-edicion">Editar la cuenta de {draft.user.email}</h2>
                <form onSubmit={save} noValidate>
                  <label className="nc-campo ancho">
                    <span>Correo</span>
                    <input
                      id="edicion-correo"
                      type="email"
                      required
                      autoComplete="off"
                      value={draft.email}
                      onChange={(e) => setDraft({ ...draft, email: e.target.value })}
                    />
                  </label>
                  {draft.profile ? (
                    <>
                      <label className="nc-campo">
                        <span>Agencia espacial</span>
                        <input id="edicion-agencia" required {...profileField("agency")} />
                      </label>
                      <label className="nc-campo">
                        <span>
                          Siglas <small>(opcional)</small>
                        </span>
                        <input id="edicion-siglas" {...profileField("acronym")} />
                      </label>
                      <label className="nc-campo">
                        <span>País</span>
                        <CountrySelect
                          id="edicion-pais"
                          required
                          value={draft.profile.country}
                          onChange={(country) =>
                            setDraft((d) => (d?.profile ? { ...d, profile: { ...d.profile, country } } : d))
                          }
                        />
                      </label>
                      <label className="nc-campo">
                        <span>Responsable</span>
                        <input id="edicion-nombre" required {...profileField("fullName")} />
                      </label>
                      <label className="nc-campo">
                        <span>
                          Cargo <small>(opcional)</small>
                        </span>
                        <input id="edicion-cargo" {...profileField("position")} />
                      </label>
                    </>
                  ) : (
                    <p className="nc-nota ancho">
                      {draft.user.role === "admin"
                        ? "La cuenta de administrador no tiene datos de agencia."
                        : "Los datos de la agencia los completa ella misma al registrarse."}
                    </p>
                  )}
                  <div className="admin-edicion-botones ancho">
                    <button className="nc-btn primario compacto" type="submit" disabled={busy || !draft.email}>
                      Guardar cambios
                    </button>
                    <button className="nc-btn secundario compacto" type="button" onClick={() => setDraft(null)}>
                      Cancelar
                    </button>
                  </div>
                </form>
              </section>
            )}

            <section aria-labelledby="admin-t-lista">
              <div className="admin-cabecera">
                <h2 id="admin-t-lista">Usuarios registrados</h2>
                {users && (
                  <span className="nc-nota">
                    {users.length} {users.length === 1 ? "cuenta" : "cuentas"}
                    {pending > 0 && ` · ${pending} pendiente${pending === 1 ? "" : "s"} de registro`}
                  </span>
                )}
              </div>
              <div className="admin-tabla nc-tarjeta">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Correo</th>
                      <th scope="col">Rol</th>
                      <th scope="col">Estado</th>
                      <th scope="col">Agencia</th>
                      <th scope="col">Responsable</th>
                      <th scope="col">País</th>
                      <th scope="col">Alta</th>
                      <th scope="col">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users?.map((u) => (
                      <tr key={u.id}>
                        <th scope="row">{u.email}</th>
                        <td>
                          <span className={`nc-insignia ${u.role === "admin" ? "acento" : "tierra"}`}>
                            {u.role === "admin" ? "Administrador" : "Agencia"}
                          </span>
                        </td>
                        <td>
                          <span className={`admin-estado ${u.status}`}>
                            {u.status === "activo" ? "Activo" : "Pendiente de registro"}
                          </span>
                          {u.status === "pendiente" && u.temporaryExpiresAt && (
                            <small className="admin-detalle">La clave temporal vence el {formatDate(u.temporaryExpiresAt)}</small>
                          )}
                          {u.status === "activo" && u.registeredAt && u.role === "agencia" && (
                            <small className="admin-detalle">Registro: {formatDate(u.registeredAt)}</small>
                          )}
                        </td>
                        <td>
                          {u.profile ? (
                            <>
                              {u.profile.agency}
                              {u.profile.acronym && <small> · {u.profile.acronym}</small>}
                            </>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td>
                          {u.profile ? (
                            <>
                              {u.profile.fullName}
                              {u.profile.position && <small> · {u.profile.position}</small>}
                            </>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td>{u.profile?.country ? displayCountry(u.profile.country) : "—"}</td>
                        <td>{formatDate(u.createdAt)}</td>
                        <td className="admin-acciones">
                          {confirm?.userId === u.id ? (
                            <>
                              <span>
                                {confirm.action === "eliminar"
                                  ? "¿Eliminar esta cuenta?"
                                  : "Tendrá que registrarse de nuevo con una clave temporal."}
                              </span>
                              <button
                                className="admin-accion peligro"
                                type="button"
                                disabled={busy}
                                onClick={() => (confirm.action === "eliminar" ? remove(u) : reissue(u))}
                              >
                                {confirm.action === "eliminar" ? "Sí, eliminar" : "Sí, restablecer"}
                              </button>
                              <button className="admin-accion" type="button" onClick={() => setConfirm(null)}>
                                Cancelar
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                className="admin-accion"
                                type="button"
                                disabled={busy}
                                onClick={() =>
                                  setDraft({
                                    user: u,
                                    email: u.email,
                                    // Un país escrito a mano ("ecuador") se lleva al nombre de la lista si se reconoce.
                                    profile: u.profile && {
                                      ...u.profile,
                                      country: matchCountry(u.profile.country) ?? u.profile.country,
                                    },
                                  })
                                }
                              >
                                Editar
                              </button>
                              {u.role === "agencia" && u.status === "pendiente" && (
                                <button className="admin-accion" type="button" disabled={busy} onClick={() => reissue(u)}>
                                  Nueva clave temporal
                                </button>
                              )}
                              {u.role === "agencia" && u.status === "activo" && (
                                <button
                                  className="admin-accion"
                                  type="button"
                                  disabled={busy}
                                  onClick={() => setConfirm({ userId: u.id, action: "restablecer" })}
                                >
                                  Restablecer acceso
                                </button>
                              )}
                              {u.id !== user.id && (
                                <button
                                  className="admin-accion peligro"
                                  type="button"
                                  disabled={busy}
                                  onClick={() => setConfirm({ userId: u.id, action: "eliminar" })}
                                >
                                  Eliminar
                                </button>
                              )}
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!users && !error && <p className="admin-vacio">Cargando usuarios…</p>}
              </div>
            </section>

            {server ? (
              <p className="nc-nota admin-servidor">
                Las cuentas se guardan en la base de datos del servidor. Las claves se guardan cifradas: nadie, tampoco el
                administrador, puede verlas después de crearlas.
              </p>
            ) : (
              <section className="admin-demo" aria-labelledby="admin-t-demo">
                <p className="nc-aviso">
                  <b>DEMO</b>
                  <span id="admin-t-demo">
                    Sin servidor: estas cuentas viven solo en este navegador y cualquiera con acceso a él puede
                    modificarlas. Sirve para probar el flujo, no para proteger información.
                  </span>
                </p>
                {confirmReset ? (
                  <div className="admin-confirmar">
                    <span>Se borrarán las cuentas creadas y quedarán solo las iniciales.</span>
                    <button className="nc-btn primario compacto" type="button" onClick={resetDemo}>
                      Sí, restablecer
                    </button>
                    <button className="nc-btn secundario compacto" type="button" onClick={() => setConfirmReset(false)}>
                      Cancelar
                    </button>
                  </div>
                ) : (
                  <button className="nc-btn secundario compacto" type="button" onClick={() => setConfirmReset(true)}>
                    Restablecer cuentas de demostración
                  </button>
                )}
              </section>
            )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
