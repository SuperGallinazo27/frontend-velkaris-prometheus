import { useState } from "react";
import type { FormEvent } from "react";
import { AccountBar } from "../../components/AccountBar";
import { CountrySelect } from "../../components/CountrySelect";
import { Icon } from "../../components/Icon";
import { AuthError, MIN_PASSWORD_LENGTH } from "../../services/auth";
import type { AgencyProfile, User } from "../../services/auth";
import { auth } from "../../services/session";
import "./auth.css";

const empty: AgencyProfile = { fullName: "", position: "", agency: "", acronym: "", country: "" };

/**
 * Segundo paso del alta de una agencia: quien entró con la clave temporal define su propia clave
 * y los datos de su agencia. Al terminar se cierra la sesión para ingresar ya de forma normal.
 */
export function Registro({ user, onDone }: { user: User; onDone: (email: string) => void }) {
  const [profile, setProfile] = useState(empty);
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const field = (key: keyof AgencyProfile) => ({
    value: profile[key],
    onChange: (e: { target: { value: string } }) => setProfile((p) => ({ ...p, [key]: e.target.value })),
  });

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (password !== repeat) {
      setError("Las dos claves no coinciden.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await auth.completeRegistration(password, profile);
      onDone(user.email);
    } catch (cause) {
      setError(cause instanceof AuthError ? cause.message : "No se pudo guardar el registro. Inténtalo de nuevo.");
      setBusy(false);
    }
  }

  return (
    <div className="nocturno claro registro">
      <AccountBar user={user} current="registro" />
      <main className="registro-caja">
        <span className="nc-eyebrow">Paso 2 de 2 · Registro de la agencia</span>
        <h1 className="nc-titulo">Completa tu registro</h1>
        <p className="nc-texto-2">
          Entraste con la clave temporal de <strong>{user.email}</strong>. Define tu propia clave y los datos de tu
          agencia espacial; después podrás ingresar de forma normal y abrir el mundo interactivo.
        </p>
        <form className="registro-form nc-tarjeta" onSubmit={submit} noValidate>
          <fieldset>
            <legend>Tu agencia</legend>
            <label className="nc-campo ancho">
              <span>Agencia espacial</span>
              <input id="registro-agencia" required autoComplete="organization" {...field("agency")} />
            </label>
            <label className="nc-campo">
              <span>
                Siglas <small>(opcional)</small>
              </span>
              <input id="registro-siglas" {...field("acronym")} />
            </label>
            <label className="nc-campo">
              <span>País</span>
              <CountrySelect
                id="registro-pais"
                required
                value={profile.country}
                onChange={(country) => setProfile((p) => ({ ...p, country }))}
              />
            </label>
          </fieldset>
          <fieldset>
            <legend>Persona responsable</legend>
            <label className="nc-campo">
              <span>Nombre completo</span>
              <input id="registro-nombre" required autoComplete="name" {...field("fullName")} />
            </label>
            <label className="nc-campo">
              <span>
                Cargo <small>(opcional)</small>
              </span>
              <input id="registro-cargo" autoComplete="organization-title" {...field("position")} />
            </label>
          </fieldset>
          <fieldset>
            <legend>Tu clave</legend>
            <label className="nc-campo">
              <span>
                Nueva clave <small>(mínimo {MIN_PASSWORD_LENGTH} caracteres)</small>
              </span>
              <input
                id="registro-clave"
                type="password"
                required
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <label className="nc-campo">
              <span>Repite la clave</span>
              <input
                id="registro-clave-2"
                type="password"
                required
                autoComplete="new-password"
                value={repeat}
                onChange={(e) => setRepeat(e.target.value)}
              />
            </label>
            <p className="nc-nota ancho">
              {auth.mode === "local"
                ? "Es una demostración: la clave se guarda en este navegador. No uses una que utilices en otros sitios."
                : "El servidor guarda tu clave cifrada: nadie puede verla, tampoco el administrador."}
            </p>
          </fieldset>
          {error && (
            <p className="nc-aviso error" role="alert">
              {error}
            </p>
          )}
          <button className="nc-btn primario" type="submit" disabled={busy}>
            {busy ? "Guardando…" : "Guardar registro"} <Icon name="arrow" size={18} />
          </button>
        </form>
      </main>
    </div>
  );
}
