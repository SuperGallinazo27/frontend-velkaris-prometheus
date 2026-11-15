import { useState } from "react";
import { decimal } from "./format";
import { LAPSE_RATE, MONTHS, RATINGS, climateSource } from "./climate";
import type { MonthProfile, Season as SeasonData, Window } from "./climate";
import type { TodayRating } from "./useClimateNow";

const capital = (text: string) => text[0].toUpperCase() + text.slice(1);

/** Diferencia de altitud a partir de la cual se avisa de que la celda del modelo representa mal el lugar. */
const ELEVATION_GAP_M = 800;

function windowText(window: Window | null): string {
  if (!window) return "Ningún mes";
  if (window.length === 12) return "Todo el año";
  if (window.length === 1) return capital(MONTHS[window.start]);
  return `De ${MONTHS[window.start]} a ${MONTHS[window.end]}`;
}

const range = (month: MonthProfile) =>
  `${decimal(month.temperatureMin)} a ${decimal(month.temperatureMax)} °C`;

/** Todo lo que se sabe de un mes típico, en una línea. Es lo que lee quien no puede usar el gráfico. */
function readout(month: MonthProfile): string {
  const water = month.temperature <= 0 ? "nieve" : "lluvia";
  return `${range(month)} · ${decimal(month.precipitation)} mm de ${water} · viento ${decimal(month.wind)} km/h · ${decimal(month.daylight, 1)} h de luz`;
}

interface Props {
  season: SeasonData;
  /** Altitud del lugar, si se conoce, para avisar cuando la celda del modelo queda lejos. */
  elevation: number | null;
  /** Mes de ahora, de 0 a 11. */
  current: number;
  /** Valoración de hoy con datos reales, si ya llegó: se muestra junto a la típica del mes actual. */
  today: TodayRating | null;
}

/**
 * Clima típico del lugar: el promedio de muchos años, mes a mes, con la mejor época para ir y una
 * valoración orientativa. Todo aquí dice «típico» a propósito: no es lo que pasa este año. Lo de
 * este año va en «Ahora»; aquí solo se repite, en el mes actual, la valoración de hoy.
 *
 * No se mezclan aquí cantidades reales de lluvia: vienen de otro modelo (Open-Meteo, 9 km) y esta
 * tabla es de NASA POWER (50 km). En montaña y en islas los dos dan cantidades muy distintas, así
 * que ponerlas juntas haría pasar por anomalía lo que solo es otra fuente.
 *
 * Temperatura y precipitación van en dos gráficos pequeños, cada uno con su propia escala, para no
 * mezclar dos ejes en uno.
 */
export function Season({ season, elevation, current, today }: Props) {
  const [active, setActive] = useState(current);
  const [table, setTable] = useState(false);
  const { year, window } = season;
  const shown = year[active];
  const period = climateSource.period.replace("-", "–");

  const low = Math.min(...year.map((m) => m.temperatureMin));
  const high = Math.max(...year.map((m) => m.temperatureMax));
  const span = Math.max(high - low, 1);
  const at = (temperature: number) => ((temperature - low) / span) * 100;
  const hottest = year.reduce((a, b) => (b.temperatureMax > a.temperatureMax ? b : a));
  const coldest = year.reduce((a, b) => (b.temperatureMin < a.temperatureMin ? b : a));

  // La escala nunca baja de 60 mm: en un desierto las barras quedan pequeñas, como debe ser.
  const wettest = year.reduce((a, b) => (b.precipitation > a.precipitation ? b : a));
  const rainScale = Math.max(60, wettest.precipitation);
  const gap = elevation === null ? 0 : elevation - season.cellElevation;

  return (
    <section className="temporada" aria-labelledby="temporada-t">
      <header>
        <h3 id="temporada-t">Clima típico</h3>
        <span className="nc-nota">Promedio de {period}: no es este año</span>
      </header>

      <div className="temporada-resumen una">
        <div>
          <span>Mejor época para ir, en un año típico</span>
          <strong>{windowText(window)}</strong>
          {window ? (
            <span className={`temporada-estado ${window.rating}`}>
              <i aria-hidden="true">{RATINGS[window.rating].symbol}</i>
              {RATINGS[window.rating].name} en promedio
              {window.length < 12 && <small> · {window.length} {window.length === 1 ? "mes" : "meses"}</small>}
            </span>
          ) : (
            <span className="temporada-estado dificil">
              <i aria-hidden="true">{RATINGS.dificil.symbol}</i>
              Todo el año es difícil
            </span>
          )}
        </div>
      </div>

      <div className="temporada-grafico" onPointerLeave={() => setActive(current)}>
        <p className="temporada-titulo">Valoración típica de cada mes para trabajo de campo</p>
        <div className="temporada-fila">
          {year.map((month) => (
            <span key={month.index} className={`temporada-celda ${month.rating}`} aria-hidden="true">
              {RATINGS[month.rating].symbol}
            </span>
          ))}
        </div>

        <p className="temporada-titulo">Temperatura típica del día, °C</p>
        <div className="temporada-fila temporada-temp" aria-hidden="true">
          {/* La línea de 0 °C, dentro de los márgenes que dejan sitio a los rótulos. */}
          {low < 0 && high > 0 && (
            <span className="temporada-cero" style={{ bottom: `calc(15px + (100% - 30px) * ${at(0) / 100})` }} />
          )}
          {year.map((month) => (
            <span key={month.index} className="temporada-pista">
              <span
                className="temporada-rango"
                style={{ bottom: `${at(month.temperatureMin)}%`, height: `${at(month.temperatureMax) - at(month.temperatureMin)}%` }}
              >
                {month === hottest && <b className="arriba">{decimal(month.temperatureMax)}°</b>}
                {month === coldest && <b className="abajo">{decimal(month.temperatureMin)}°</b>}
              </span>
            </span>
          ))}
        </div>

        <p className="temporada-titulo">Precipitación típica, mm al mes</p>
        <div className="temporada-fila temporada-lluvia" aria-hidden="true">
          {year.map((month) => (
            <span key={month.index} className="temporada-pista">
              <span className="temporada-barra" style={{ height: `${(month.precipitation / rainScale) * 100}%` }}>
                {month === wettest && month.precipitation > 0 && <b className="arriba">{decimal(month.precipitation)}</b>}
              </span>
            </span>
          ))}
        </div>

        <div className="temporada-fila temporada-meses" aria-hidden="true">
          {year.map((month) => (
            <span key={month.index} className={month.index === current ? "actual" : undefined}>
              {MONTHS[month.index][0].toUpperCase()}
            </span>
          ))}
        </div>

        {/* Una franja por mes, de arriba abajo: no hay que acertar a una barra de 10 píxeles. */}
        <div className="temporada-toque">
          {year.map((month) => (
            <button
              key={month.index}
              type="button"
              className={month.index === current ? "actual" : undefined}
              aria-pressed={month.index === active}
              aria-label={`${capital(MONTHS[month.index])} típico: ${RATINGS[month.rating].name}. ${readout(month)}`}
              onPointerEnter={() => setActive(month.index)}
              onFocus={() => setActive(month.index)}
              onClick={() => setActive(month.index)}
            />
          ))}
        </div>
      </div>

      <div className="temporada-lectura" aria-live="polite">
        <strong>{capital(MONTHS[shown.index])} típico</strong>
        <span>{readout(shown)}</span>
        <span className={`temporada-estado ${shown.rating}`}>
          <i aria-hidden="true">{RATINGS[shown.rating].symbol}</i>
          {RATINGS[shown.rating].name} en promedio
          {shown.reasons.length > 0 && <small> · {shown.reasons.join(", ")}</small>}
        </span>
        {shown.index === current && today && (
          <span className={`temporada-estado ${today.rating} temporada-hoy`}>
            <i aria-hidden="true">{RATINGS[today.rating].symbol}</i>
            Hoy, de verdad: {RATINGS[today.rating].name.toLowerCase()}
            {today.reasons.length > 0 && <small> ({today.reasons.join(", ")})</small>}
          </span>
        )}
      </div>

      <ul className="temporada-leyenda" aria-label="Significado de la valoración">
        {(Object.keys(RATINGS) as (keyof typeof RATINGS)[]).map((rating) => (
          <li key={rating}>
            <span className={`temporada-celda ${rating}`} aria-hidden="true">
              {RATINGS[rating].symbol}
            </span>
            {RATINGS[rating].name}
          </li>
        ))}
      </ul>

      <button type="button" className="temporada-tabla-boton" aria-expanded={table} onClick={() => setTable((open) => !open)}>
        {table ? "Ocultar tabla" : "Ver los doce meses en una tabla"}
      </button>
      {table && (
        <div className="temporada-tabla">
          <table>
            <thead>
              <tr>
                <th scope="col">Mes típico</th>
                <th scope="col">°C</th>
                <th scope="col">mm</th>
                <th scope="col">km/h</th>
                <th scope="col">Luz</th>
                <th scope="col">Valoración</th>
              </tr>
            </thead>
            <tbody>
              {year.map((month) => (
                <tr key={month.index} className={month.index === current ? "actual" : undefined}>
                  <th scope="row">{capital(MONTHS[month.index]).slice(0, 3)}</th>
                  <td>
                    {decimal(month.temperatureMin)} / {decimal(month.temperatureMax)}
                  </td>
                  <td>{decimal(month.precipitation)}</td>
                  <td>{decimal(month.wind)}</td>
                  <td>{decimal(month.daylight, 1)} h</td>
                  <td>{RATINGS[month.rating].name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {Math.abs(gap) >= ELEVATION_GAP_M && (
        <p className="nc-aviso temporada-aviso">
          <b>OJO</b>
          <span>
            El dato climático es de una celda de unos 50 km que queda {decimal(Math.abs(gap))} m más{" "}
            {gap > 0 ? "abajo" : "arriba"} que este lugar. En montañas e islas, la lluvia y el viento reales pueden ser muy
            distintos.
          </span>
        </p>
      )}
      <p className="nc-nota">
        Promedios mensuales de{" "}
        <a href={climateSource.url} target="_blank" rel="noreferrer">
          NASA POWER
        </a>
        {season.adjusted
          ? `, con la temperatura ajustada a la altitud del lugar (${decimal(LAPSE_RATE, 1)} °C por km).`
          : ", sin ajuste de altitud."}{" "}
        Las horas de luz se calculan con la latitud. La valoración típica es un criterio orientativo de PROMETHEUS
        (lluvia, frío, calor, viento y luz); no es un requisito oficial ni un pronóstico. Estas cantidades de lluvia no
        se pueden comparar con las de «Ahora», que vienen de otro modelo, de celda más pequeña: por eso allí lo que llovió
        se compara con otros años del mismo modelo y no con esta tabla.
      </p>
    </section>
  );
}
