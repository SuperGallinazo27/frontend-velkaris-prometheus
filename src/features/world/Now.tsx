import { useState } from "react";
import { compassOf } from "../../services/weather";
import { MONTHS, RATINGS } from "./climate";
import type { RainCheck, Season } from "./climate";
import { ensoSentence, ensoStatus, nearNino12 } from "./enso";
import { decimal } from "./format";
import { clockAt, clockOf, differenceText, hoursAhead, viewerOffsetMinutes, zoneName } from "./placeTime";
import { GROUND_STATES } from "./soilState";
import type { ClimateNow } from "./useClimateNow";

/** Cómo queda la lluvia de los últimos 30 días frente a la de esas fechas en años anteriores. */
const RAIN_TITLES: Record<RainCheck, string> = {
  "mucho-mas": "Mucho más de lo habitual",
  mas: "Más de lo habitual",
  normal: "Dentro de lo habitual",
  menos: "Menos de lo habitual",
};

/** Clase de color de cada tono; el símbolo y el texto dicen lo mismo sin depender del color. */
const TONE_CLASS = { bien: "favorable", medio: "aceptable", mal: "dificil" } as const;

/** `2026-11-04` → «4 de noviembre de 2026». */
function longDate(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  return MONTHS[month - 1] ? `${day} de ${MONTHS[month - 1]} de ${year}` : iso;
}

const capital = (text: string) => text[0].toUpperCase() + text.slice(1);

/** `2026-10-16` → «16 de octubre». */
function shortDate(iso: string): string {
  const [, month, day] = iso.split("-").map(Number);
  return MONTHS[month - 1] ? `${day} de ${MONTHS[month - 1]}` : iso;
}

interface Props {
  now: ClimateNow;
  latitude: number;
  longitude: number;
  season: Season | null;
}

/**
 * «Ahora»: lo que de verdad está pasando en el lugar. Un solo bloque con el tiempo, la lluvia de
 * los últimos 30 días, el estado del suelo y El Niño, y una única valoración de hoy para trabajo
 * de campo. Nada de aquí es un promedio: el clima típico va aparte, en «Clima típico».
 *
 * La lluvia de 30 días se compara con la de esas mismas fechas en años anteriores según el mismo
 * modelo, no con el clima típico, que es de otra fuente y en montaña da cantidades distintas.
 *
 * La hora se dice sin rodeos: es la del lugar, no la de quien mira, y el dato es el último que
 * calculó el modelo, no una medición de este instante.
 */
export function Now({ now, latitude, longitude, season }: Props) {
  const [openedAt] = useState(() => Date.now());
  const { weather, rain, ground, enso, today, baseline } = now;
  const loading = weather.status === "cargando" || rain.status === "cargando" || ground.status === "cargando";
  const failed = weather.status === "error" && rain.status === "error" && ground.status === "error";

  const current = weather.status === "ok" ? weather.value : null;
  const offset = current?.utcOffsetSeconds ?? (ground.status === "listo" ? ground.result.forecast.utcOffsetSeconds : null);
  const timezone = current?.timezone || (ground.status === "listo" ? ground.result.forecast.timezone : "");
  const difference = offset === null ? null : differenceText(hoursAhead(offset, viewerOffsetMinutes(new Date(openedAt))));

  const recent = rain.status === "ok" ? rain.value : null;
  const typicalMonth = season?.year[now.month] ?? null;
  // Donde hiela, lo que cae no es solo lluvia: se dice «precipitación».
  const freezing = current ? current.temperature <= 0 : typicalMonth ? typicalMonth.temperature <= 0 : false;
  const water = freezing ? "precipitación" : "lluvia";
  const past = baseline.status === "ok" ? baseline.value : null;

  const result = ground.status === "listo" ? ground.result : null;
  const state = result ? GROUND_STATES[result.reading.state] : null;

  const ensoNow = enso ? ensoStatus(enso) : null;
  const ensoText = ensoNow ? ensoSentence(ensoNow) : null;
  const coastal = enso?.weekly && nearNino12(latitude, longitude) ? enso.weekly : null;

  return (
    <section className="ahora" aria-labelledby="ahora-t" aria-busy={loading}>
      <header>
        <h3 id="ahora-t">Ahora</h3>
        <span className="nc-nota">Datos reales de hoy</span>
      </header>

      {offset !== null && (
        <p className="ahora-hora">
          Allí son las <strong>{clockAt(openedAt, offset)}</strong>, {zoneName(timezone, new Date(openedAt))}
          {difference ? ` (${difference})` : ""}.
        </p>
      )}

      {today ? (
        <p className="ahora-valoracion">
          <span>Hoy, para trabajo de campo</span>
          <span className={`temporada-estado ${today.rating}`}>
            <i aria-hidden="true">{RATINGS[today.rating].symbol}</i>
            <strong>{RATINGS[today.rating].name}</strong>
          </span>
          {today.reasons.length > 0 && <span className="ahora-motivos">{capital(today.reasons.join(", "))}.</span>}
        </p>
      ) : failed ? (
        <p className="mundo-clima-error">
          No se pudieron consultar los datos de hoy. Revisa la conexión.
          <button type="button" onClick={now.retry}>
            Reintentar
          </button>
        </p>
      ) : (
        <p className="nc-nota">Consultando los datos de hoy…</p>
      )}

      <div className="ahora-tarjetas">
        <article className="ahora-tarjeta" aria-labelledby="ahora-tiempo">
          <h4 id="ahora-tiempo">Tiempo</h4>
          {weather.status === "cargando" && <p className="nc-nota">Consultando el tiempo…</p>}
          {weather.status === "error" && <p className="nc-nota">No se pudo consultar el tiempo de ahora.</p>}
          {current && (
            <>
              <p className="ahora-principal">
                <span className="mono">{decimal(current.temperature, 1)} °C</span>
                <span>
                  {current.description}
                  <small>
                    Sensación {decimal(current.apparentTemperature, 1)} °C{current.isDay ? "" : " · de noche"}
                  </small>
                </span>
              </p>
              <dl>
                <div>
                  <dt>Viento</dt>
                  <dd>
                    {decimal(current.windSpeed)} km/h {compassOf(current.windDirection)}
                  </dd>
                </div>
                <div>
                  <dt>Humedad</dt>
                  <dd>{decimal(current.humidity)} %</dd>
                </div>
                <div>
                  <dt>Nubes</dt>
                  <dd>{decimal(current.cloudCover)} %</dd>
                </div>
                <div>
                  <dt>{capital(water)} ahora</dt>
                  <dd>{decimal(current.precipitation, 1)} mm</dd>
                </div>
                <div>
                  <dt>Presión</dt>
                  <dd>{decimal(current.pressure)} hPa</dd>
                </div>
                {Number.isFinite(current.elevation) && (
                  <div>
                    <dt>Altitud del modelo</dt>
                    <dd>{decimal(current.elevation)} m</dd>
                  </div>
                )}
              </dl>
              <p className="ahora-pie">
                Dato del modelo de las {clockOf(current.time)} (hora de allí). El modelo calcula un valor cada{" "}
                {Math.round((current.intervalSeconds ?? 900) / 60)} minutos y la aplicación lo reutiliza 10 minutos: no es
                el instante exacto ni una estación en el lugar.
              </p>
            </>
          )}
        </article>

        <article className="ahora-tarjeta" aria-labelledby="ahora-suelo">
          <h4 id="ahora-suelo">Suelo</h4>
          {ground.status === "cargando" && <p className="nc-nota">Consultando la humedad del suelo…</p>}
          {ground.status === "error" && <p className="nc-nota">No se pudo consultar la humedad del suelo.</p>}
          {result && state && (
            <>
              <p className={`temporada-estado ahora-estado ${TONE_CLASS[state.tone]}`}>
                <i aria-hidden="true">{state.symbol}</i>
                <strong>{state.name}</strong>
              </p>
              <p className="ahora-texto">{result.reading.reason}</p>
              <p className="ahora-texto">
                {capital(water)}: {decimal(result.forecast.rain72hMm)} mm en 72 horas y {decimal(result.forecast.rain7dMm)}{" "}
                mm en 7 días.
              </p>
              <p className="ahora-pie">
                {result.limits.generic
                  ? "El mapa de suelos no tiene la textura de este lugar: se usan los límites de un suelo franco. "
                  : ""}
                Humedad del suelo según el modelo, en una celda de varios kilómetros: es una estimación, no una medición
                en el lugar. El pronóstico de la semana está en «Ruedas».
              </p>
            </>
          )}
        </article>

        <article
          className={`ahora-tarjeta${now.rainCheck && now.rainCheck !== "normal" ? " distinto" : ""}`}
          aria-labelledby="ahora-lluvia"
        >
          <h4 id="ahora-lluvia">{capital(water)} de los últimos 30 días</h4>
          {rain.status === "cargando" && <p className="nc-nota">Consultando la {water} de estos días…</p>}
          {rain.status === "error" && <p className="nc-nota">No se pudo consultar la {water} de estos días.</p>}
          {recent && (
            <>
              <p className="ahora-principal">
                <span className="mono">{decimal(recent.totalMm)} mm</span>
                {now.rainCheck && <span>{RAIN_TITLES[now.rainCheck]}</span>}
              </p>
              {baseline.status === "cargando" && <p className="nc-nota">Consultando estas mismas fechas en otros años…</p>}
              {baseline.status === "error" && (
                <p className="ahora-texto">No se pudo consultar cuánto cayó en estas fechas otros años.</p>
              )}
              {past && (
                <p className="ahora-texto">
                  En estas mismas fechas, de {past.years[0].year} a {past.years[past.years.length - 1].year} cayeron entre{" "}
                  {decimal(past.minMm)} y {decimal(past.maxMm)} mm ({decimal(past.meanMm)} mm de media).
                  {recent.totalMm > past.maxMm && past.years.length > 1 && " Este año supera a todos ellos."}
                  {recent.totalMm < past.minMm && past.years.length > 1 && " Este año queda por debajo de todos ellos."}
                </p>
              )}
              <p className="ahora-pie">
                Del {shortDate(recent.from)} al {shortDate(recent.to)}. Se compara con el mismo modelo en otros años, no
                con la tabla de clima típico, que es de otra fuente.
              </p>
            </>
          )}
        </article>
      </div>

      {ensoText && enso && ensoNow && (
        <p className="nc-aviso temporada-aviso">
          <b>OJO</b>
          <span>
            {ensoText}
            {coastal &&
              ` Frente a Ecuador y Perú, el mar está ${decimal(Math.abs(coastal.nino12.anomaly), 1)} °C ${coastal.nino12.anomaly >= 0 ? "más caliente" : "más frío"} de lo normal (semana del ${longDate(coastal.week)}).`}{" "}
            Altera las lluvias en muchas regiones: este año, el clima típico puede no cumplirse. Fuente:{" "}
            <a href={enso.source.oni} target="_blank" rel="noreferrer">
              NOAA
            </a>
            , dato leído el {longDate(enso.fetchedAt)}.
          </span>
        </p>
      )}

      <p className="nc-nota">
        Tiempo, lluvia y humedad del suelo:{" "}
        <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">
          Open-Meteo
        </a>{" "}
        (CC BY 4.0), modelos meteorológicos para estas coordenadas; la lluvia de 30 días y la de otros años son de su{" "}
        <a href="https://open-meteo.com/en/docs/historical-weather-api" target="_blank" rel="noreferrer">
          archivo histórico
        </a>
        . Ninguno es una medición en el lugar. La valoración de hoy es un criterio orientativo de
        PROMETHEUS: usa la lluvia de 30 días, la temperatura y el viento de hoy, las horas de luz y el estado del suelo. Un
        suelo embarrado hace el día difícil aunque hoy no llueva.
      </p>
    </section>
  );
}
