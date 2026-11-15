import { useEffect, useState } from "react";
import { TurnoError, turnos } from "../../services/turnos";
import { STATE_NAMES, STRICT_IUCN, areaLabel, joinNames } from "../../services/turnosRules";
import type { PlaceState, PlaceStatus } from "../../services/turnosRules";
import { STATE_MARK, shortDate } from "../turnos/format";
import { ProtectedSource } from "../turnos/TurnoPanel";

type Filter = "todos" | "disponibles" | "permiso" | "bloqueados";

const FILTERS: { id: Filter; name: string; match: (state: PlaceState) => boolean }[] = [
  { id: "todos", name: "Todos los lugares", match: () => true },
  { id: "disponibles", name: "Disponibles", match: (state) => state === "libre" },
  { id: "permiso", name: "Con permiso", match: (state) => state === "permiso" || state === "habilitado" },
  { id: "bloqueados", name: "No reservables", match: (state) => state === "protegido" || state === "cerrado" || state === "sin_dato" },
];

const DATASET_TEXT: Record<PlaceStatus["datasetStatus"], string> = {
  libre: "Sin área protegida en el punto",
  permiso: "Área de uso múltiple o sin categoría",
  protegido: "Protección estricta",
  sin_dato: "Aún sin consultar",
};

interface Edit {
  placeId: string;
  mode: "habilitado" | "cerrado";
}

const messageOf = (cause: unknown) =>
  cause instanceof TurnoError ? cause.message : "No se pudo completar la acción. Inténtalo de nuevo.";

/**
 * Los lugares del portal: qué dice la base de áreas protegidas de cada uno y si se puede reservar.
 * El administrador puede cerrar un lugar, o habilitar uno bloqueado cuando una agencia tiene permiso.
 */
export function AdminLugares() {
  const [places, setPlaces] = useState<PlaceStatus[] | null>(null);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  const [filter, setFilter] = useState<Filter>("todos");
  const [edit, setEdit] = useState<Edit | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    turnos
      .places()
      .then((list) => !cancelled && setPlaces(list))
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

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await action();
      setEdit(null);
      setReason("");
      setVersion((n) => n + 1);
    } catch (cause) {
      setError(messageOf(cause));
    }
    setBusy(false);
  }

  const all = places ?? [];
  const match = FILTERS.find((item) => item.id === filter)!.match;
  const shown = all.filter((place) => match(place.status)).sort((a, b) => a.name.localeCompare(b.name, "es"));
  const figures = FILTERS.slice(1).map((item) => ({
    name: item.name,
    value: all.filter((place) => item.match(place.status)).length,
  }));

  return (
    <>
      <p className="nc-texto-2 admin-intro">
        Qué dice de cada lugar la base mundial de áreas protegidas y si se puede reservar. Puedes cerrar un lugar (por
        ejemplo, por una erupción) o habilitar uno bloqueado cuando una agencia presenta el permiso de la autoridad del
        área. La agencia siempre ve el motivo.
      </p>

      <dl className="admin-cifras" aria-label="Resumen de lugares">
        {figures.map((figure) => (
          <div key={figure.name} className="nc-tarjeta">
            <dt>{figure.name}</dt>
            <dd>{places ? figure.value : "—"}</dd>
          </div>
        ))}
      </dl>

      {error && (
        <p className="nc-aviso error" role="alert">
          {error}
        </p>
      )}

      <section aria-labelledby="admin-t-lugares">
        <div className="admin-cabecera">
          <h2 id="admin-t-lugares">Lugares</h2>
          {places && (
            <span className="nc-nota">
              {shown.length} de {all.length} lugares
            </span>
          )}
        </div>
        <div className="admin-filtros">
          <label className="nc-campo">
            <span>Mostrar</span>
            <select id="lugares-filtro" value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
              {FILTERS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="admin-tabla nc-tarjeta">
          <table>
            <thead>
              <tr>
                <th scope="col">Lugar</th>
                <th scope="col">Según la base de áreas protegidas</th>
                <th scope="col">Para reservar</th>
                <th scope="col">Turnos activos</th>
                <th scope="col">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((place) => {
                const mark = STATE_MARK[place.status];
                const blockedByDataset = place.datasetStatus === "protegido" || place.datasetStatus === "sin_dato";
                const editing = edit?.placeId === place.id ? edit : null;
                return (
                  <tr key={place.id}>
                    <th scope="row">
                      {place.name}
                      <small className="admin-detalle">
                        {place.province}, {place.country}
                      </small>
                    </th>
                    <td className="admin-ancha">
                      {DATASET_TEXT[place.datasetStatus]}
                      {place.areas.length > 0 && (
                        <small className="admin-detalle">{joinNames(place.areas.slice(0, 3).map(areaLabel))}</small>
                      )}
                      {place.nearbyStrict.length > 0 && (
                        <small className="admin-detalle">
                          El área de 18 km toca: {joinNames(place.nearbyStrict.slice(0, 2).map(areaLabel))}
                        </small>
                      )}
                    </td>
                    <td className="admin-ancha">
                      <span className={`turnos-insignia ${mark.tone}`}>
                        <i aria-hidden="true">{mark.symbol}</i>
                        {STATE_NAMES[place.status]}
                      </span>
                      {place.override && (
                        <small className="admin-detalle">
                          Decisión del {shortDate(place.override.updatedAt)}: {place.override.reason}
                        </small>
                      )}
                    </td>
                    <td>
                      {place.activeReservations}
                      {place.occupiedToday && <small className="admin-detalle">Ocupado hoy</small>}
                    </td>
                    <td className="admin-acciones">
                      {editing ? (
                        <>
                          <label className="nc-campo admin-motivo">
                            <span>
                              {editing.mode === "cerrado"
                                ? "Motivo del cierre (las agencias lo verán)"
                                : "Permiso y autoridad que lo dio (las agencias lo verán)"}
                            </span>
                            <input
                              id={`lugar-motivo-${place.id}`}
                              maxLength={300}
                              value={reason}
                              onChange={(e) => setReason(e.target.value)}
                            />
                          </label>
                          <button
                            className="admin-accion peligro"
                            type="button"
                            disabled={busy || !reason.trim()}
                            onClick={() => run(() => turnos.setOverride(place.id, editing.mode, reason))}
                          >
                            {editing.mode === "cerrado" ? "Sí, cerrar el lugar" : "Sí, habilitar con permiso"}
                          </button>
                          <button
                            className="admin-accion"
                            type="button"
                            onClick={() => {
                              setEdit(null);
                              setReason("");
                            }}
                          >
                            Volver
                          </button>
                        </>
                      ) : (
                        <>
                          {place.override && (
                            <button
                              className="admin-accion"
                              type="button"
                              disabled={busy}
                              onClick={() => run(() => turnos.clearOverride(place.id))}
                            >
                              {place.override.mode === "cerrado" ? "Reabrir" : "Quitar la habilitación"}
                            </button>
                          )}
                          {blockedByDataset && place.override?.mode !== "habilitado" && (
                            <button
                              className="admin-accion"
                              type="button"
                              disabled={busy}
                              onClick={() => {
                                setEdit({ placeId: place.id, mode: "habilitado" });
                                setReason("");
                              }}
                            >
                              Habilitar con permiso
                            </button>
                          )}
                          {place.override?.mode !== "cerrado" && (
                            <button
                              className="admin-accion peligro"
                              type="button"
                              disabled={busy}
                              onClick={() => {
                                setEdit({ placeId: place.id, mode: "cerrado" });
                                setReason("");
                              }}
                            >
                              Cerrar
                            </button>
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!places && !error && <p className="admin-vacio">Cargando lugares…</p>}
          {places && shown.length === 0 && <p className="admin-vacio">Ningún lugar coincide con el filtro.</p>}
        </div>
      </section>

      <p className="nc-nota admin-servidor">
        <strong>La regla.</strong> Si el punto del lugar cae dentro de un área de protección estricta (categorías UICN{" "}
        {STRICT_IUCN.join(", ")}), no se puede reservar. Si cae en un área de uso múltiple (V o VI) o sin categoría
        informada, se reserva solo declarando el permiso. Cerrar un lugar no cancela los turnos ya reservados: cancélalos
        en la pestaña «Turnos» si hace falta.
      </p>
      <ProtectedSource />
    </>
  );
}
