import { useEffect, useState } from "react";
import { AccountBar } from "../../components/AccountBar";
import type { User } from "../../services/auth";
import { TurnoError, turnos } from "../../services/turnos";
import type { Reservation } from "../../services/turnos";
import { LIMITS, PHASE_NAMES, rangeText } from "../../services/turnosRules";
import { shortDate, usd } from "./format";
import { TurnoScope } from "./TurnoPanel";
import "./turnos.css";

const messageOf = (cause: unknown) =>
  cause instanceof TurnoError ? cause.message : "No se pudo completar la acción. Inténtalo de nuevo.";

/** Lo que se sabe del plan con el que se reservó, en una línea. */
function planLine(turno: Reservation): string {
  const parts = [
    turno.mission,
    turno.robot && `robot ${turno.robot}`,
    turno.people && `${turno.people} ${turno.people === 1 ? "persona" : "personas"}`,
    turno.estimatedCostUsd !== null && `costo estimado ${usd(turno.estimatedCostUsd)}`,
  ].filter(Boolean);
  return parts.join(" · ");
}

/** Turnos de la agencia que tiene la sesión: los que vienen, el que está en curso y el historial. */
export function MisTurnos({ user }: { user: User }) {
  const [list, setList] = useState<Reservation[] | null>(null);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    turnos
      .mine()
      .then((mine) => !cancelled && setList(mine))
      .catch((cause) => !cancelled && setError(messageOf(cause)));
    return () => {
      cancelled = true;
    };
  }, [version]);

  useEffect(() => {
    const stop = turnos.subscribe(() => setVersion((n) => n + 1));
    return () => {
      stop();
    };
  }, []);

  async function cancel(turno: Reservation) {
    setBusy(true);
    setError("");
    try {
      await turnos.cancel(turno.id, reason);
      setConfirm(null);
      setReason("");
      // La versión local avisa sola; con servidor también, pero volver a pedir no hace daño.
      setVersion((n) => n + 1);
    } catch (cause) {
      setError(messageOf(cause));
    }
    setBusy(false);
  }

  const active = (list ?? [])
    .filter((turno) => turno.phase === "proximo" || turno.phase === "en_curso")
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
  const past = (list ?? []).filter((turno) => turno.phase === "terminado" || turno.phase === "cancelado");

  const card = (turno: Reservation) => (
    <li key={turno.id} className="turno-tarjeta nc-tarjeta">
      <div className="turno-datos">
        <h3>{turno.placeName}</h3>
        <p>
          <strong>{rangeText(turno.startDate, turno.endDate)}</strong> · {turno.days} {turno.days === 1 ? "día" : "días"}
        </p>
        {planLine(turno) && <p>{planLine(turno)}</p>}
        {turno.permitReference && (
          <p>
            Permiso declarado: <strong>{turno.permitReference}</strong>. El turno queda condicionado a ese permiso.
          </p>
        )}
      </div>
      <div className="turno-lado">
        <span className={`turno-fase ${turno.phase}`}>{PHASE_NAMES[turno.phase]}</span>
        <code className="turno-codigo">{turno.code}</code>
      </div>
      {turno.status === "cancelado" && (
        <p className="turno-motivo">
          {turno.cancelledBy === "admin" ? "Lo canceló el administrador" : "Lo cancelaste"} el {shortDate(turno.cancelledAt)}
          {turno.cancelReason ? `: ${turno.cancelReason}` : "."}
        </p>
      )}
      {(turno.phase === "proximo" || turno.phase === "en_curso") &&
        (confirm === turno.id ? (
          <div className="turno-cancelar">
            <label className="nc-campo">
              <span>
                Motivo <small>(opcional)</small>
              </span>
              <input
                id={`cancelar-motivo-${turno.id}`}
                maxLength={300}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <button className="nc-btn primario compacto" type="button" disabled={busy} onClick={() => cancel(turno)}>
              Sí, cancelar el turno
            </button>
            <button
              className="nc-btn secundario compacto"
              type="button"
              onClick={() => {
                setConfirm(null);
                setReason("");
              }}
            >
              Volver
            </button>
          </div>
        ) : (
          <div className="turno-cancelar">
            <button
              className="nc-btn secundario compacto"
              type="button"
              onClick={() => {
                setConfirm(turno.id);
                setReason("");
              }}
            >
              Cancelar turno
            </button>
            <span className="nc-nota">Al cancelar, esos días quedan libres para otra agencia.</span>
          </div>
        ))}
    </li>
  );

  return (
    <div className="nocturno claro mis-turnos">
      <AccountBar user={user} current="turnos" />
      <main className="mis-turnos-caja">
        <span className="nc-eyebrow">Portal de turnos</span>
        <h1 className="nc-titulo">Mis turnos</h1>
        <p className="nc-texto-2 mis-turnos-intro">
          Los turnos de {user.profile?.agency || "tu agencia"}. Para reservar, abre un lugar en el{" "}
          <a href="#mundo">mundo interactivo</a> y entra en su pestaña «Turnos», o hazlo al terminar un plan de
          campaña.
        </p>

        {error && (
          <p className="nc-aviso error" role="alert">
            {error}
          </p>
        )}

        <section aria-labelledby="turnos-t-activos">
          <h2 id="turnos-t-activos">Próximos y en curso</h2>
          {!list && !error && <p className="nc-nota">Cargando tus turnos…</p>}
          {list && active.length === 0 && (
            <div className="mis-turnos-vacio nc-tarjeta">
              <p className="nc-texto-2">Aún no tienes turnos reservados.</p>
              <a className="nc-btn primario compacto" href="#mundo">
                Elegir un lugar
              </a>
            </div>
          )}
          {active.length > 0 && <ul className="mis-turnos-lista">{active.map(card)}</ul>}
        </section>

        {past.length > 0 && (
          <section aria-labelledby="turnos-t-historial">
            <h2 id="turnos-t-historial">Historial</h2>
            <ul className="mis-turnos-lista">{past.map(card)}</ul>
          </section>
        )}

        <p className="nc-nota">
          Cada agencia puede tener hasta {LIMITS.maxActivePerAgency} turnos activos, de hasta {LIMITS.maxDays} días cada
          uno y con hasta 24 meses de anticipación.
        </p>
        <TurnoScope />
        {turnos.mode === "local" && (
          <p className="nc-aviso">
            <b>DEMO</b>
            <span>
              Sin servidor: estos turnos viven solo en este navegador. Sirve para probar el flujo; «otra agencia» es
              otra cuenta de demostración abierta aquí mismo.
            </span>
          </p>
        )}
      </main>
    </div>
  );
}
