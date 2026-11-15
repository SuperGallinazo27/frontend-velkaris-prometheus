import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useSession } from "../../services/session";
import { TurnoError, turnos } from "../../services/turnos";
import type { Availability, Reservation } from "../../services/turnos";
import {
  LIMITS,
  STATE_NAMES,
  addDays,
  areaLabel,
  joinNames,
  nextFreeStart,
  overlaps,
  protectedSource,
  rangeProblem,
  rangeText,
  toIsoDate,
} from "../../services/turnosRules";
import type { PlaceStatus } from "../../services/turnosRules";
import { SOURCE_RELEASE, STATE_MARK, areaAuthority, areaDetail } from "./format";
import "./turnos.css";

/** Datos del plan de campaña del que sale el turno. */
export interface PlanDefaults {
  /** Primer día propuesto, `AAAA-MM-DD`. */
  start: string;
  days: number;
  mission: string;
  robot: string | null;
  people: number;
  costUsd: number;
}

interface Props {
  placeId: string;
  /** Con un plan, el formulario llega relleno y el turno guarda sus datos. */
  plan?: PlanDefaults;
}

type Loaded = { placeId: string; data: Availability; error?: undefined } | { placeId: string; error: string; data?: undefined };

const HEADLINES: Record<PlaceStatus["status"], string> = {
  libre: "Disponible para reservar",
  permiso: "Se reserva declarando el permiso",
  habilitado: "Habilitado por el administrador, con permiso",
  protegido: "No se puede reservar: área de protección estricta",
  cerrado: "No se puede reservar: cerrado por el administrador",
  sin_dato: "No se puede reservar: falta consultar las áreas protegidas",
};

const messageOf = (cause: unknown) =>
  cause instanceof TurnoError ? cause.message : "No se pudo completar la acción. Inténtalo de nuevo.";

/** Aviso de qué es un turno y qué no. Va en todas las pantallas donde se reserva. */
export function TurnoScope() {
  return (
    <p className="nc-nota">
      El turno coordina a las agencias de este portal: evita que dos coincidan en el mismo lugar. No reemplaza los
      permisos del país, del dueño del terreno ni de la autoridad de un área protegida.
    </p>
  );
}

/** De dónde salen las áreas protegidas, con la cita y el mes de la versión que pide la fuente. */
export function ProtectedSource() {
  return (
    <p className="nc-nota">
      Áreas protegidas: UNEP-WCMC y UICN, Protected Planet, base mundial WDPCA, versión de {SOURCE_RELEASE} (
      <a href={protectedSource.url} target="_blank" rel="noreferrer">
        protectedplanet.net
      </a>
      ). La base puede estar incompleta o tener límites imprecisos. Qué se puede reservar es un criterio de PROMETHEUS
      apoyado en las categorías de la UICN, no un dictamen legal.
    </p>
  );
}

/**
 * Turnos de un lugar: si se puede reservar y por qué, los días ya ocupados y, para una agencia,
 * el formulario para reservar. Se usa en la ficha del lugar y al final del plan de campaña.
 */
export function TurnoPanel({ placeId, plan }: Props) {
  const user = useSession();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [version, setVersion] = useState(0);
  const [start, setStart] = useState(() => plan?.start ?? addDays(toIsoDate(new Date()), 30));
  const [days, setDays] = useState(() => Math.min(LIMITS.maxDays, Math.max(1, plan?.days ?? 10)));
  const [permit, setPermit] = useState("");
  const [mission, setMission] = useState(() => plan?.mission ?? "");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [booked, setBooked] = useState<Reservation | null>(null);
  // Tras reservar, el formulario se guarda: con las mismas fechas chocaría con el turno recién hecho.
  const [formOpen, setFormOpen] = useState(true);

  useEffect(() => {
    let cancelled = false;
    turnos
      .availability(placeId)
      .then((data) => !cancelled && setLoaded({ placeId, data }))
      .catch((cause) => !cancelled && setLoaded({ placeId, error: messageOf(cause) }));
    return () => {
      cancelled = true;
    };
  }, [placeId, version]);

  // Si otra pantalla reserva o cancela, o el administrador decide sobre el lugar, se vuelve a consultar.
  useEffect(() => {
    const stop = turnos.subscribe(() => setVersion((n) => n + 1));
    return () => {
      stop();
    };
  }, []);

  const current = loaded?.placeId === placeId ? loaded : null;
  if (!current) return <p className="nc-nota turnos">Consultando los turnos de este lugar…</p>;
  if (current.error !== undefined) {
    return (
      <div className="turnos">
        <p className="nc-aviso error" role="alert">
          {current.error}
        </p>
        <button type="button" className="nc-btn secundario compacto" onClick={() => setVersion((n) => n + 1)}>
          Reintentar
        </button>
      </div>
    );
  }

  const { place, busy, today } = current.data;
  const mark = STATE_MARK[place.status];
  const end = addDays(start || today, days - 1);
  const problem = rangeProblem(start, end, today);
  const clash = problem ? undefined : busy.find((range) => overlaps(start, end, range.startDate, range.endDate));
  const free = clash ? nextFreeStart(busy, start, days, today) : null;
  const isAgency = user?.role === "agencia";
  const canSend = isAgency && place.bookable && !problem && !clash && !sending && (!place.permitRequired || permit.trim() !== "");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!canSend) return;
    setSending(true);
    setError("");
    try {
      const reservation = await turnos.book({
        placeId,
        startDate: start,
        endDate: end,
        permitReference: place.permitRequired ? permit : undefined,
        mission: mission || undefined,
        robot: plan?.robot ?? undefined,
        people: plan?.people,
        estimatedCostUsd: plan ? Math.round(plan.costUsd) : undefined,
      });
      setBooked(reservation);
      setPermit("");
      setFormOpen(false);
    } catch (cause) {
      setError(messageOf(cause));
      // Otra agencia pudo reservar mientras tanto: se muestran sus días.
      setVersion((n) => n + 1);
    }
    setSending(false);
  }

  return (
    <section className="turnos" aria-label={`Turnos de ${place.name}`}>
      <div className={`turnos-estado ${mark.tone}`}>
        <i aria-hidden="true">{mark.symbol}</i>
        <div>
          <strong>{HEADLINES[place.status]}</strong>
          <p>{place.reason}</p>
        </div>
      </div>

      {place.areas.length > 0 && (
        <ul className="turnos-areas" aria-label="Áreas protegidas que contienen este punto">
          {place.areas.map((area) => (
            <li key={`${area.siteId}-${area.iucn}-${area.designation}`} className={area.strict ? "estricta" : undefined}>
              <strong>{area.name}</strong>
              <span>
                {areaDetail(area)}
                {area.statusYear ? ` · desde ${area.statusYear}` : ""}
              </span>
              {areaAuthority(area) && <small>Autoridad: {areaAuthority(area)}</small>}
            </li>
          ))}
        </ul>
      )}

      {place.nearbyStrict.length > 0 && (
        <p className="nc-aviso">
          <b>OJO</b>
          <span>
            El punto del lugar queda fuera, pero el área de 18 km que se analiza toca{" "}
            {joinNames(place.nearbyStrict.slice(0, 3).map(areaLabel))}
            {place.nearbyStrict.length > 3 ? ` y ${place.nearbyStrict.length - 3} más` : ""}: protección estricta. El
            turno no cubre trabajar dentro de esas áreas.
          </span>
        </p>
      )}

      <div className="turnos-ocupados">
        <h4>Días ocupados</h4>
        {busy.length ? (
          <ul>
            {busy.map((range) => (
              <li key={`${range.startDate}-${range.endDate}`}>
                <span>{rangeText(range.startDate, range.endDate)}</span>
                {range.mine ? (
                  <em className="propio">Tu turno</em>
                ) : (
                  <em>{range.agency ?? "Otra agencia"}</em>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="nc-nota">
            {place.bookable ? "Nadie ha reservado todavía: todas las fechas están libres." : "No hay turnos reservados."}
          </p>
        )}
      </div>

      {booked && (
        <div className="nc-aviso ok turnos-hecho" role="status">
          <div>
            <strong>Turno reservado.</strong> {booked.placeName}, {rangeText(booked.startDate, booked.endDate)} (
            {booked.days} {booked.days === 1 ? "día" : "días"}).
            <code>{booked.code}</code>
          </div>
          <a className="nc-btn secundario compacto" href="#turnos">
            Ver mis turnos
          </a>
        </div>
      )}

      {isAgency && place.bookable && !formOpen && !plan && (
        <button
          type="button"
          className="nc-btn secundario compacto turnos-otro"
          onClick={() => {
            // Se propone el primer hueco que no pisa ningún turno, tampoco el recién reservado.
            setStart(nextFreeStart(busy, start, days, today) ?? start);
            setError("");
            setFormOpen(true);
          }}
        >
          Reservar otro turno aquí
        </button>
      )}

      {isAgency && place.bookable && formOpen && (
        <form className="turnos-form" onSubmit={submit} noValidate>
          <h4>{plan ? "Reservar el turno de este plan" : "Reservar un turno"}</h4>
          <div className="turnos-fechas">
            <label className="nc-campo">
              <span>Primer día</span>
              <input
                id={`turno-inicio-${placeId}`}
                type="date"
                required
                min={today}
                max={addDays(today, LIMITS.maxDaysAhead)}
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </label>
            <label className="nc-campo">
              <span>
                Días <small>(máximo {LIMITS.maxDays})</small>
              </span>
              <input
                id={`turno-dias-${placeId}`}
                type="number"
                required
                min={1}
                max={LIMITS.maxDays}
                value={days}
                onChange={(e) => setDays(Math.min(LIMITS.maxDays, Math.max(1, Math.round(Number(e.target.value)) || 1)))}
              />
            </label>
          </div>
          {!problem && <p className="turnos-rango">Turno {rangeText(start, end)}.</p>}
          {place.permitRequired && (
            <label className="nc-campo">
              <span>Permiso de la autoridad del área</span>
              <input
                id={`turno-permiso-${placeId}`}
                required
                maxLength={200}
                autoComplete="off"
                placeholder="Número o referencia del permiso"
                value={permit}
                onChange={(e) => setPermit(e.target.value)}
              />
            </label>
          )}
          {!plan && (
            <label className="nc-campo">
              <span>
                Nombre de la misión <small>(opcional)</small>
              </span>
              <input
                id={`turno-mision-${placeId}`}
                maxLength={120}
                placeholder="Prueba de movilidad del rover"
                value={mission}
                onChange={(e) => setMission(e.target.value)}
              />
            </label>
          )}
          {problem && (
            <p className="nc-aviso error" role="alert">
              {problem}
            </p>
          )}
          {clash && (
            <div className="nc-aviso error turnos-choque" role="alert">
              <span>
                {clash.mine ? "Tu agencia ya tiene este lugar" : "Ocupado: otra agencia tiene este lugar"}{" "}
                {rangeText(clash.startDate, clash.endDate)}.
                {free && ` El primer hueco para ${days} ${days === 1 ? "día" : "días"} empieza ${rangeText(free, free)}.`}
              </span>
              {free && (
                <button type="button" className="nc-btn secundario compacto" onClick={() => setStart(free)}>
                  Usar esa fecha
                </button>
              )}
            </div>
          )}
          {error && !clash && (
            <p className="nc-aviso error" role="alert">
              {error}
            </p>
          )}
          <button className="nc-btn primario compacto" type="submit" disabled={!canSend}>
            {sending ? "Reservando…" : "Reservar turno"}
          </button>
          {place.permitRequired && (
            <p className="nc-nota">
              PROMETHEUS no verifica el permiso: lo guarda con el turno y el administrador lo ve como «condicionado a
              permiso».
            </p>
          )}
        </form>
      )}

      {user?.role === "admin" && (
        <p className="nc-nota">
          Como administrador no reservas turnos: los gestionas, y cierras o habilitas lugares, en{" "}
          <a href="#admin">Administración</a>. Estado para reservar: {STATE_NAMES[place.status].toLowerCase()}.
        </p>
      )}

      <TurnoScope />
      <ProtectedSource />
    </section>
  );
}
