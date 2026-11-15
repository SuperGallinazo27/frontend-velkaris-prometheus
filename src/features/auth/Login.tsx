import { useState } from "react";
import type { FormEvent } from "react";
import { Brand } from "../../components/Brand";
import { LanguageSwitch } from "../../components/LanguageSwitch";
import { Icon } from "../../components/Icon";
import { AuthError } from "../../services/auth";
import { auth } from "../../services/session";
import "./auth.css";

/** Mensaje que deja el registro al terminar, para mostrarlo una vez en el ingreso. */
export interface LoginNotice {
  email: string;
  message: string;
}

export function Login({ notice }: { notice: LoginNotice | null }) {
  const [email, setEmail] = useState(notice?.email ?? "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      // Al iniciar sesión, la aplicación lleva a cada cuenta a su pantalla.
      await auth.login(email, password);
    } catch (cause) {
      setError(cause instanceof AuthError ? cause.message : "No se pudo iniciar sesión. Inténtalo de nuevo.");
      setBusy(false);
    }
  }

  return (
    <div className="nocturno claro acceso">
      <a className="acceso-volver" href="#inicio">
        <span aria-hidden="true">←</span> Volver a la portada
      </a>
      <LanguageSwitch />
      <main className="acceso-caja nc-tarjeta">
        <Brand surface="claro" label="PROMETHEUS by VELKARIS, volver a la portada" />
        <div>
          <h1 className="nc-titulo">Inicia sesión</h1>
          <p className="nc-texto-2">Con tu correo y tu clave, o con la clave temporal que te dio el administrador.</p>
        </div>
        {notice && (
          <p className="nc-aviso ok" role="status">
            {notice.message}
          </p>
        )}
        <form className="acceso-form" onSubmit={submit} noValidate>
          <label className="nc-campo">
            <span>Correo</span>
            <input
              id="acceso-correo"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label className="nc-campo">
            <span>Clave</span>
            <input
              id="acceso-clave"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {error && (
            <p className="nc-aviso error" role="alert">
              {error}
            </p>
          )}
          <button className="nc-btn primario" type="submit" disabled={busy || !email || !password}>
            {busy ? "Entrando…" : "Entrar"} <Icon name="arrow" size={18} />
          </button>
        </form>
        {auth.mode === "local" ? (
          <p className="nc-aviso">
            <b>DEMO</b>
            <span>
              Acceso de demostración sin servidor: las cuentas se guardan solo en este navegador. No es un sistema de
              seguridad real.
            </span>
          </p>
        ) : (
          <p className="nc-nota">
            El acceso se comprueba en el servidor de PROMETHEUS. Si lleva un rato sin uso, la primera respuesta puede
            tardar hasta un minuto.
          </p>
        )}
      </main>
    </div>
  );
}
