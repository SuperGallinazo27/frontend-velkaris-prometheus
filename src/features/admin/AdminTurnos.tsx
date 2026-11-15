import { useEffect, useState } from "react";
import { TurnoError, turnos } from "../../services/turnos";
import type { Reservation } from "../../services/turnos";
import { PHASE_NAMES, rangeText } from "../../services/turnosRules";
import type { Phase } from "../../services/turnosRules";
import { shortDate, usd } from "../turnos/format";
import { TurnoScope } from "../turnos/TurnoPanel";

type PhaseFilter = "activos" | "todos" | Phase;

const FILTERS: { id: PhaseFilter; name: string }[] = [
  { id: "activos", name: "Activos (próximos y en curso)" },
  { id: "todos", name: "Todos" },
  { id: "proximo", name: "Próximos" },
  { id: "en_curso", name: "En curso" },
  { id: "terminado", name: "Terminados" },
  { id: "cancelado", name: "Cancelados" },
];

const messageOf = (cause: unknown) =>
  cause instanceof TurnoError ? cause.message : "No se pudo completar la acción. Inténtalo de nuevo.";

const isActive = (turno: Reservation) => turno.phase === "proximo" || turno.phase === "en_curso";

const agencyName = (turno: Reservation) => turno.agency?.agency || turno.agency?.email || "Agencia eliminada";

/** Lo que se sabe del plan con el que se reservó, en una línea. */
const planLine = (turno: Reservation) =>
  [
    turno.mission,
    turno.robot && `robot ${turno.robot}`,
    turno.people && `${turno.people} ${turno.people === 1 ? "persona" : "personas"}`,
    turno.estimatedCostUsd !== null && usd(turno.estimatedCostUsd),
  ]
    .filter(Boolean)
    .join(" · ");

/** Todos los turnos del portal: quién tiene qué lugar y cuándo. El administrador puede cancelar con motivo. */
export function AdminTurnos() {
  const [list, setList] = useState<Reservation[] | null>(null);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  const [phase, setPhase] = useState<PhaseFilter>("activos");
  const [placeId, setPlaceId] = useState("");
  const [agencyId, setAgencyId] = useState("");
  const [confirm, setConfirm] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    turnos
      .all()
      .then((all) => !cancelled && setList(all))
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
      setVersion((n) => n + 1);
    } catch (cause) {
      setError(messageOf(cause));
    }
    setBusy(false);
  }

  const all = list ?? [];
  const places = [...new Map(all.map((turno) => [turno.placeId, turno.placeName])).entries()].sort((a, b) =>
    a[1].localeCompare(b[1], "es"),
  );
  const agencies = [...new Map(all.filter((t) => t.agency).map((turno) => [turno.agency!.userId, agencyName(turno)])).entries()].sort(
    (a, b) => a[1].localeCompare(b[1], "es"),
  );
  const shown = all
    .filter((turno) => (phase === "todos" ? true : phase === "activos" ? isActive(turno) : turno.phase === phase))
    .filter((turno) => !placeId || turno.placeId === placeId)
    .filter((turno) => !agencyId || turno.agency?.userId === agencyId)
    .sort((a, b) => a.startDate.localeCompare(b.startDate));

  const figures = [
    { name: "Activos", value: all.filter(isActive).length },
    { name: "En curso hoy", value: all.filter((t) => t.phase === "en_curso").length },
    { name: "Próximos", value: all.filter((t) => t.phase === "proximo").length },
    { name: "Condicionados a permiso", value: all.filter((t) => isActive(t) && t.permitReference).length },
    { name: "Cancelados", value: all.filter((t) => t.phase === "cancelado").length },
  ];

  return (
    <>
      <p className="nc-texto-2 admin-intro">
        Todos los turnos que han reservado las agencias. Un lugar solo puede tenerlo una agencia a la vez; si cancelas un
        turno, la agencia verá el motivo en «Mis turnos» y esos días quedan libres.
      </p>

      <dl className="admin-cifras" aria-label="Resumen de turnos">
        {figures.map((figure) => (
          <div key={figure.name} className="nc-tarjeta">
            <dt>{figure.name}</dt>
            <dd>{list ? figure.value : "—"}</dd>
          </div>
        ))}
      </dl>

      {error && (
        <p className="nc-aviso error" role="alert">
          {error}
        </p>
      )}

      <section aria-labelledby="admin-t-turnos">
        <div className="admin-cabecera">
          <h2 id="admin-t-turnos">Turnos</h2>
          {list && (
            <span className="nc-nota">
              {shown.length} de {all.length} {all.length === 1 ? "turno" : "turnos"}
            </span>
          )}
        </div>
        <div className="admin-filtros">
          <label className="nc-campo">
            <span>Estado</span>
            <select id="turnos-filtro-estado" value={phase} onChange={(e) => setPhase(e.target.value as PhaseFilter)}>
              {FILTERS.map((filter) => (
                <option key={filter.id} value={filter.id}>
                  {filter.name}
                </option>
              ))}
            </select>
          </label>
          <label className="nc-campo">
            <span>Lugar</span>
            <select id="turnos-filtro-lugar" value={placeId} onChange={(e) => setPlaceId(e.target.value)}>
              <option value="">Todos los lugares</option>
              {places.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label className="nc-campo">
            <span>Agencia</span>
            <select id="turnos-filtro-agencia" value={agencyId} onChange={(e) => setAgencyId(e.target.value)}>
              <option value="">Todas las agencias</option>
              {agencies.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="admin-tabla nc-tarjeta">
          <table>
            <thead>
              <tr>
                <th scope="col">Turno</th>
                <th scope="col">Lugar y plan</th>
                <th scope="col">Fechas</th>
                <th scope="col">Agencia</th>
                <th scope="col">Estado</th>
                <th scope="col">Permiso</th>
                <th scope="col">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((turno) => (
                <tr key={turno.id}>
                  <th scope="row">
                    <code className="turno-codigo">{turno.code}</code>
                    <small className="admin-detalle">Reservado el {shortDate(turno.createdAt)}</small>
                  </th>
                  <td className="admin-ancha">
                    {turno.placeName}
                    {planLine(turno) && <small className="admin-detalle">{planLine(turno)}</small>}
                  </td>
                  <td className="admin-ancha">
                    {rangeText(turno.startDate, turno.endDate)}
                    <small className="admin-detalle">
                      {turno.days} {turno.days === 1 ? "día" : "días"}
                    </small>
                  </td>
                  <td className="admin-ancha">
                    {agencyName(turno)}
                    {turno.agency?.acronym && <small> · {turno.agency.acronym}</small>}
                    {turno.agency && <small className="admin-detalle">{turno.agency.email}</small>}
                  </td>
                  <td className="admin-ancha">
                    <span className={`turno-fase ${turno.phase}`}>{PHASE_NAMES[turno.phase]}</span>
                    {turno.status === "cancelado" && (
                      <small className="admin-detalle">
                        {turno.cancelledBy === "admin" ? "Por el administrador" : "Por la agencia"}, el{" "}
                        {shortDate(turno.cancelledAt)}
                        {turno.cancelReason ? `: ${turno.cancelReason}` : ""}
                      </small>
                    )}
                  </td>
                  <td className="admin-ancha">
                    {turno.permitReference ? (
                      <>
                        <span className="turnos-insignia medio">Condicionado a permiso</span>
                        <small className="admin-detalle">{turno.permitReference}</small>
                      </>
                    ) : (
                      "No requiere"
                    )}
                  </td>
                  <td className="admin-acciones">
                    {!isActive(turno) ? (
                      "—"
                    ) : confirm === turno.id ? (
                      <>
                        <label className="nc-campo admin-motivo">
                          <span>Motivo (la agencia lo verá)</span>
                          <input
                            id={`admin-motivo-${turno.id}`}
                            maxLength={300}
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                          />
                        </label>
                        <button
                          className="admin-accion peligro"
                          type="button"
                          disabled={busy || !reason.trim()}
                          onClick={() => cancel(turno)}
                        >
                          Sí, cancelar el turno
                        </button>
                        <button
                          className="admin-accion"
                          type="button"
                          onClick={() => {
                            setConfirm(null);
                            setReason("");
                          }}
                        >
                          Volver
                        </button>
                      </>
                    ) : (
                      <button
                        className="admin-accion peligro"
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          setConfirm(turno.id);
                          setReason("");
                        }}
                      >
                        Cancelar turno
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!list && !error && <p className="admin-vacio">Cargando turnos…</p>}
          {list && shown.length === 0 && (
            <p className="admin-vacio">
              {all.length === 0 ? "Ninguna agencia ha reservado un turno todavía." : "Ningún turno coincide con el filtro."}
            </p>
          )}
        </div>
      </section>

      <TurnoScope />
      {turnos.mode === "local" && (
        <p className="nc-aviso">
          <b>DEMO</b>
          <span>Sin servidor: los turnos viven solo en este navegador.</span>
        </p>
      )}
    </>
  );
}
