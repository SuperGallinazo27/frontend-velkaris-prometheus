import type { User } from "../services/auth";
import { auth } from "../services/session";
import { Brand } from "./Brand";
import { LanguageSwitch } from "./LanguageSwitch";

/** Barra superior de las pantallas con sesión: marca, secciones según el rol y salida. */
export function AccountBar({ user, current }: { user: User; current: "admin" | "mundo" | "hangar" | "registro" | "turnos" }) {
  return (
    <header className="nc-barra">
      <Brand label="PROMETHEUS by VELKARIS, volver a la portada" />
      {user.role === "admin" && (
        <nav aria-label="Secciones">
          <a href="#admin" aria-current={current === "admin" ? "page" : undefined}>
            Administración
          </a>
          <a href="#mundo" aria-current={current === "mundo" ? "page" : undefined}>
            Mundo
          </a>
          <a href="#hangar" aria-current={current === "hangar" ? "page" : undefined}>
            Hangar
          </a>
        </nav>
      )}
      {user.role === "agencia" && user.status === "activo" && (
        <nav aria-label="Secciones">
          <a href="#mundo" aria-current={current === "mundo" ? "page" : undefined}>
            Mundo
          </a>
          <a href="#hangar" aria-current={current === "hangar" ? "page" : undefined}>
            Hangar
          </a>
          <a href="#turnos" aria-current={current === "turnos" ? "page" : undefined}>
            Mis turnos
          </a>
        </nav>
      )}
      <div className="nc-cuenta">
        <LanguageSwitch />
        <span>{user.email}</span>
        <span className={`nc-insignia ${user.role === "admin" ? "acento" : "tierra"}`}>
          {user.role === "admin" ? "Administrador" : "Agencia"}
        </span>
        <button className="nc-btn secundario compacto" type="button" onClick={() => auth.logout()}>
          Cerrar sesión
        </button>
      </div>
    </header>
  );
}
