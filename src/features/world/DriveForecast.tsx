import { useState } from "react";
import { SLIP_LIMIT } from "../mission/wheelData";
import type { VehiclePreset } from "../mission/wheelData";
import { DRIVE_VERDICTS, driveVerdict } from "../mission/wheelLab";
import type { DriveOutlook, DriveVerdict } from "../mission/wheelLab";
import { decimal } from "./format";
import { dayLabel } from "./placeTime";
import { GROUND_STATES, SOIL_STATE_SOURCES } from "./soilState";
import type { GroundDayState, GroundNow } from "./useGroundNow";
import { useDriveOutlooks } from "./useWheelLab";

interface Props {
  vehicle: VehiclePreset;
  /** Pendiente típica del lugar, en grados. */
  slope: number;
  /** El suelo de cada día, ya con la clase de suelo con la que se quiere calcular. */
  ground: GroundNow;
}

interface Row {
  state: GroundDayState;
  label: string;
  outlook: DriveOutlook | null;
  verdict: DriveVerdict | null;
}

const degrees = (value: number) => `${decimal(value, 1)}°`;
const capital = (text: string) => text[0].toUpperCase() + text.slice(1);

/** Hasta dónde llega ese día: «hasta 9,3°», o que ni en llano avanza. */
const reach = (outlook: DriveOutlook) =>
  outlook.flat.outcome === "avanza" ? `hasta ${degrees(outlook.maxSlope)}` : "ni en llano";

/** «Hoy», «Mañana» y después el día de la semana abreviado con su número: «mié 18». */
function labelOf(date: string, index: number): string {
  if (index === 0) return "Hoy";
  if (index === 1) return "Mañana";
  const [weekday, day] = dayLabel(date).split(" ");
  return `${weekday.slice(0, 3)} ${day}`;
}

/** «lluvia», o «precipitación» el día en que hiela: entonces no cae solo lluvia. */
const waterOf = (state: GroundDayState) =>
  state.day.temperatureMax !== null && state.day.temperatureMax <= 0 ? "precipitación" : "lluvia";

/** Una frase con lo que importa: cómo está hoy y cuál es el mejor día de la semana. */
function headline(rows: Row[], vehicle: VehiclePreset, slope: number): string {
  const ready = rows.filter((row) => row.verdict !== null);
  if (!ready.length) return "Calculando la rueda en el suelo de cada día…";
  const today = ready[0];
  // Si el estado del suelo no cambia el cálculo (clase con una sola fila), no se le atribuye el resultado.
  const counts = today.state.soil.responds || today.state.reading.state === "nevado";
  const todayText = `Hoy${counts ? `, con el suelo ${GROUND_STATES[today.state.reading.state].name.toLowerCase()},` : ""} ${vehicle.subject} ${
    today.verdict === "bien" ? "rueda bien" : today.verdict === "cuidado" ? "avanza, pero con cuidado," : "se atasca"
  } en la pendiente típica de aquí (${degrees(slope)}).`;
  if (ready.every((row) => row.verdict === today.verdict)) {
    return `${todayText} Toda la semana sigue igual.`;
  }
  const order: DriveVerdict[] = ["bien", "cuidado", "atasca"];
  const best = [...ready].sort(
    (a, b) => order.indexOf(a.verdict!) - order.indexOf(b.verdict!) || b.outlook!.maxSlope - a.outlook!.maxSlope,
  )[0];
  if (best === today) return `${todayText} Es el mejor día de la semana.`;
  return `${todayText} El mejor día es ${best.label.toLowerCase()}: ${DRIVE_VERDICTS[best.verdict!].name.toLowerCase()}, ${reach(best.outlook!)}.`;
}

/**
 * Pronóstico de rodadura: para hoy y los seis días siguientes, cómo estará el suelo (según la
 * humedad que prevé el modelo meteorológico) y qué le pasa a la rueda del robot en ese suelo.
 *
 * Son siete filas con su estado y su veredicto en texto y símbolo; el color solo acompaña. La
 * tabla completa está a un clic.
 */
export function DriveForecast({ vehicle, slope, ground }: Props) {
  const [table, setTable] = useState(false);
  const days = ground.status === "listo" ? ground.result.days : [];
  const outlooks = useDriveOutlooks(
    vehicle.id,
    days.map((item) => item.soil.preset.id),
    slope,
  );

  const rows: Row[] = days.map((state, index) => {
    const outlook = outlooks?.find((item) => item.soil === state.soil.preset.id) ?? null;
    return { state, label: labelOf(state.day.date, index), outlook, verdict: outlook ? driveVerdict(outlook) : null };
  });
  const responds = days[0]?.soil.responds ?? true;
  const freezing = days.some((item) => waterOf(item) === "precipitación");

  return (
    <section className="rodadura" aria-labelledby="rodadura-t" aria-busy={ground.status === "cargando"}>
      <header>
        <h3 id="rodadura-t">Pronóstico de rodadura</h3>
        <span className="nc-nota">7 días · {vehicle.name}</span>
      </header>

      {ground.status === "cargando" && <p className="nc-nota">Consultando la humedad del suelo de la semana…</p>}
      {ground.status === "error" && (
        <p className="mundo-clima-error">
          No se pudo consultar la humedad del suelo. Revisa la conexión.
          <button type="button" onClick={ground.retry}>
            Reintentar
          </button>
        </p>
      )}

      {ground.status === "listo" && (
        <>
          <p className="rodadura-hoy">{headline(rows, vehicle, slope)}</p>

          <ol className={outlooks ? undefined : "calculando"}>
            {rows.map((row) => {
              const state = GROUND_STATES[row.state.reading.state];
              return (
                <li key={row.state.day.date}>
                  <span className="rodadura-dia">{row.label}</span>
                  <span className="rodadura-suelo">
                    Suelo {state.name.toLowerCase()}
                    <small>
                      {row.state.day.rainMm >= 1
                        ? `${decimal(row.state.day.rainMm)} mm de ${waterOf(row.state)}`
                        : `sin ${waterOf(row.state)}`}
                    </small>
                  </span>
                  {row.verdict && row.outlook ? (
                    <span className="rodadura-resultado">
                      <span className={`rodadura-veredicto ${row.verdict}`}>
                        <i aria-hidden="true">{DRIVE_VERDICTS[row.verdict].symbol}</i>
                        {DRIVE_VERDICTS[row.verdict].name}
                      </span>
                      <small>{reach(row.outlook)}</small>
                    </span>
                  ) : (
                    <span className="rodadura-resultado">
                      <small>calculando…</small>
                    </span>
                  )}
                </li>
              );
            })}
          </ol>

          <button type="button" className="rodadura-boton" aria-expanded={table} onClick={() => setTable((open) => !open)}>
            {table ? "Ocultar tabla" : "Ver la semana en una tabla"}
          </button>
          {table && (
            <div className="temporada-tabla">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Día</th>
                    <th scope="col">Suelo</th>
                    <th scope="col">Agua</th>
                    <th scope="col">{freezing ? "Precipitación" : "Lluvia"}</th>
                    <th scope="col">Se hunde</th>
                    <th scope="col">Sube hasta</th>
                    <th scope="col">Veredicto</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.state.day.date}>
                      <th scope="row">{capital(dayLabel(row.state.day.date))}</th>
                      <td>{row.state.soil.preset.name}</td>
                      <td>
                        {row.state.soil.moisturePercent === null ? "—" : `${decimal(row.state.soil.moisturePercent)} %`}
                      </td>
                      <td>{decimal(row.state.day.rainMm)} mm</td>
                      <td>
                        {row.outlook?.flat.sinkage == null ? "—" : `${decimal(row.outlook.flat.sinkage * 100, 1)} cm`}
                      </td>
                      <td>{row.outlook ? (row.outlook.flat.outcome === "avanza" ? degrees(row.outlook.maxSlope) : "ni en llano") : "—"}</td>
                      <td>{row.verdict ? DRIVE_VERDICTS[row.verdict].name : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="nc-nota">«Agua»: humedad del suelo en % de su peso seco, la medida que usan las tablas de rueda y suelo.</p>
            </div>
          )}

          <p className="nc-nota">
            Cada día se toma la humedad del suelo que prevé el modelo meteorológico (
            <a href={SOIL_STATE_SOURCES.moisture.url} target="_blank" rel="noreferrer">
              Open-Meteo
            </a>
            ).{" "}
            {responds
              ? "Su estado decide con qué fila de la tabla publicada se calcula: embarrado, la más húmeda de su clase; seco o húmedo, la de humedad más parecida entre las demás. Son valores publicados para suelos de esa clase, no medidos aquí."
              : "Para esta clase de suelo la tabla publicada solo trae una fila: el estado del suelo se muestra, pero el cálculo solo cambia si hay nieve."}{" "}
            «Rueda bien» es avanzar en la pendiente típica patinando como mucho un {decimal(SLIP_LIMIT * 100)} %; «con cuidado»,
            avanzar patinando más o hundiéndose mucho; «se atasca», no avanzar. Es un pronóstico de un modelo sobre otro
            modelo: orienta la elección de fechas, no sustituye una prueba en el terreno.
          </p>
        </>
      )}
    </section>
  );
}
