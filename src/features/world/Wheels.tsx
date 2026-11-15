import { useState } from "react";
import suelos from "../../data/sueloReal.json";
import type { Climb } from "../mission/terramechanics";
import {
  EARTH_SOILS,
  MOON_SOIL,
  REFERENCES,
  SLIP_LIMIT,
  LUNAR_VEHICLES,
  SOURCES,
  soilById,
  suggestSoil,
  vehicleById,
} from "../mission/wheelData";
import type { SoilId, Source, Texture, VehicleId } from "../mission/wheelData";
import { CURVE_SLOPES, compare } from "../mission/wheelLab";
import type { WorldResult } from "../mission/wheelLab";
import { DriveForecast } from "./DriveForecast";
import { SlipChart } from "./SlipChart";
import type { SlipSeries } from "./SlipChart";
import { decimal } from "./format";
import { GROUND_STATES, SOIL_STATE_SOURCES } from "./soilState";
import type { GroundStateId, WheelSoil } from "./soilState";
import { useGroundNow } from "./useGroundNow";
import { useWheelLab } from "./useWheelLab";
import "./clima.css";

const textures = suelos.sites as Record<string, Texture | null>;

interface Props {
  placeId: string;
  latitude: number;
  longitude: number;
  /** Pendiente típica del lugar (mediana de las ventanas de 3 km), en grados. */
  placeSlope: number;
  regionName: string;
  /** Pendiente típica de la región lunar, en grados. */
  regionSlope: number;
}

const cm = (meters: number | null) => (meters === null ? "—" : `${decimal(meters * 100, 1)} cm`);
const degrees = (value: number) => `${decimal(value, 1)}°`;
const percent = (value: number) => `${decimal(value)} %`;
const slipText = (climb: Climb) =>
  climb.outcome === "avanza" ? percent(climb.slip! * 100) : climb.outcome === "atascado" ? "se atasca" : "se entierra";
const round1 = (value: number) => Math.round(value * 10) / 10;

function seriesOf(id: string, name: string, tone: SlipSeries["tone"], world: WorldResult, slope: number): SlipSeries {
  const stuck = world.curve.find((climb) => climb.outcome !== "avanza");
  return {
    id,
    name,
    tone,
    slips: world.curve.map((climb) => (climb.outcome === "avanza" ? climb.slip : null)),
    marker: { slope, slip: world.typical.outcome === "avanza" ? world.typical.slip : null },
    stuckFrom: stuck ? stuck.slopeDeg : null,
  };
}

/** Fuentes sin repetir, en el orden en que aparecen. */
function unique(sources: Source[]): Source[] {
  return sources.filter((source, index) => sources.findIndex((s) => s.url === source.url) === index);
}

/** Con qué fila de la tabla publicada se calcula el suelo de hoy, y por qué esa. */
function todaySoilReason(state: GroundStateId, soil: WheelSoil): string {
  const name = `«${soil.preset.name}»`;
  if (state === "nevado") return `Se calcula con ${name}.`;
  if (!soil.responds) {
    return `Se calcula con ${name}, la única fila que la tabla publicada trae para esa clase de suelo, así que la humedad no cambia el cálculo.`;
  }
  if (state === "helado") {
    return `La tabla publicada no trae suelo helado: se calcula con ${name}, la fila más seca de su clase.`;
  }
  if (state === "embarrado") return `Se calcula con ${name}, la fila más húmeda publicada para su clase.`;
  return `Se calcula con ${name}, la fila publicada de su clase con la humedad más parecida.`;
}

/**
 * Pestaña «Ruedas»: el mismo vehículo en la región lunar y en este lugar, con el modelo clásico
 * de rueda y suelo. Dice qué es medido, qué es estimado y cómo se comprobó el cálculo.
 *
 * El suelo de aquí no es fijo: cambia con la humedad. Por defecto se calcula con el suelo de hoy
 * (la fila publicada de su clase que corresponde a su estado y a su humedad, ver `wheelSoil`) y,
 * arriba, el pronóstico de rodadura dice cómo le irá a la rueda cada día de la semana.
 */
export function Wheels({ placeId, latitude, longitude, placeSlope, regionName, regionSlope }: Props) {
  const texture = textures[placeId] ?? null;
  const suggestion = suggestSoil(texture);
  const [vehicleId, setVehicleId] = useState<VehicleId>("viper");
  // null mientras nadie elija: entonces manda el suelo de hoy y, si aún no llegó, el sugerido.
  const [choice, setChoice] = useState<SoilId | null>(null);
  const family = soilById(choice ?? suggestion.id).family;
  const ground = useGroundNow(placeId, latitude, longitude, family);
  const todaySoil = ground.status === "listo" ? ground.result.soil.preset.id : null;
  const soilId = choice ?? todaySoil ?? suggestion.id;
  const vehicle = vehicleById(vehicleId);
  const soil = soilById(soilId);
  const moonSlope = round1(regionSlope);
  const earthSlope = round1(placeSlope);
  const { data, pending } = useWheelLab(vehicleId, soilId, moonSlope, earthSlope);

  const result = data?.result;
  const verdict = result ? compare(result) : null;
  const sources = unique([
    ...vehicle.sources,
    ...MOON_SOIL.sources,
    ...soil.sources,
    SOURCES.viperWheel,
    SOURCES.curiositySlip,
    SOURCES.moonFacts,
    SOURCES.validity,
    SOURCES.slopeLab,
    SOURCES.gravityOffset,
    ...(texture ? [{ label: suelos.source.name + " · " + suelos.source.citation, url: suelos.source.url }] : []),
    SOIL_STATE_SOURCES.moisture,
    SOIL_STATE_SOURCES.pedotransfer,
    SOIL_STATE_SOURCES.pedotransferCode,
    SOIL_STATE_SOURCES.trafficability,
    SOIL_STATE_SOURCES.fieldCapacity,
  ]);
  /** «(sugerido)», «(hoy)» o las dos cosas, junto al nombre de un suelo de la lista. */
  const tagOf = (id: SoilId) => {
    const tags = [suggestion.fromMap && id === suggestion.id ? "sugerido" : "", id === todaySoil ? "hoy" : ""].filter(Boolean);
    return tags.length ? ` (${tags.join(", ")})` : "";
  };

  return (
    <div className="ruedas">
      <p className="nc-texto-2 ruedas-intro">
        El mismo robot en {regionName}, en la Luna, y aquí: cuánto se hunde la rueda, cuánto patina y hasta qué
        pendiente sube.
      </p>

      <div className="ruedas-controles">
        <label className="nc-campo">
          <span>Robot</span>
          <select value={vehicleId} onChange={(event) => setVehicleId(event.target.value as VehicleId)}>
            {LUNAR_VEHICLES.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </label>
        <label className="nc-campo">
          <span>Suelo aquí</span>
          <select value={soilId} onChange={(event) => setChoice(event.target.value as SoilId)}>
            {EARTH_SOILS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {tagOf(s.id)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="nc-nota">
        {vehicle.detail}. Suelo: {soil.detail.charAt(0).toLowerCase() + soil.detail.slice(1)}.{" "}
        {texture
          ? `El mapa mundial de suelos SoilGrids (una predicción a 250 m, no una medición) estima aquí ${decimal(texture.sand)} % de arena y ${decimal(texture.clay)} % de arcilla.`
          : placeId in textures
            ? "El mapa mundial de suelos no tiene dato aquí (glaciar, roca o agua): elige el suelo que corresponda."
            : "Este lugar aún no se consultó en el mapa mundial de suelos: elige el suelo que corresponda."}
      </p>
      {ground.status === "listo" && (
        <p className="nc-nota ruedas-hoy">
          Hoy el suelo está {GROUND_STATES[ground.result.reading.state].name.toLowerCase()}
          {ground.result.soil.moisturePercent !== null &&
            ` (un ${decimal(ground.result.soil.moisturePercent)} % de agua respecto a su peso seco, según el modelo meteorológico)`}
          .{" "}
          {choice === null || choice === todaySoil
            ? todaySoilReason(ground.result.reading.state, ground.result.soil)
            : "Estás calculando con otro suelo."}{" "}
          {choice !== null && choice !== todaySoil && (
            <button type="button" className="rodadura-boton" onClick={() => setChoice(null)}>
              Volver al suelo de hoy
            </button>
          )}
        </p>
      )}

      <DriveForecast vehicle={vehicle} slope={earthSlope} ground={ground} />

      {result && data ? (
        <>
          <table className={`ruedas-cifras${pending ? " calculando" : ""}`}>
            <thead>
              <tr>
                <th scope="col">{vehicle.name}</th>
                <th scope="col">Luna</th>
                <th scope="col">Aquí</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">Hundimiento en llano</th>
                <td>{cm(result.moon.flat.sinkage)}</td>
                <td>{cm(result.earth.flat.sinkage)}</td>
              </tr>
              <tr>
                <th scope="row">Patinaje en la pendiente típica</th>
                <td>
                  {slipText(result.moon.typical)} <small>a {degrees(moonSlope)}</small>
                </td>
                <td>
                  {slipText(result.earth.typical)} <small>a {degrees(earthSlope)}</small>
                </td>
              </tr>
              <tr>
                <th scope="row">Pendiente máxima con hasta {percent(SLIP_LIMIT * 100)} de patinaje</th>
                <td>{degrees(result.moon.maxSlope)}</td>
                <td>{degrees(result.earth.maxSlope)}</td>
              </tr>
            </tbody>
          </table>

          {verdict && (
            <p className="ruedas-veredicto">
              {verdict.kind === "parecido" &&
                `Aquí ${vehicle.subject} sube casi lo mismo que en la Luna (${degrees(Math.abs(verdict.difference))} de diferencia): para esta rueda, este suelo se comporta parecido al regolito estimado.`}
              {verdict.kind === "mas-dificil" &&
                `Aquí ${vehicle.subject} sube ${degrees(Math.abs(verdict.difference))} menos que en la Luna: para esta rueda, este suelo es más exigente que el regolito estimado.`}
              {verdict.kind === "mas-facil" &&
                `Aquí ${vehicle.subject} sube ${degrees(verdict.difference)} más que en la Luna: una prueba aquí sería más fácil que la misión real.`}
            </p>
          )}

          <SlipChart
            slopes={CURVE_SLOPES}
            limit={SLIP_LIMIT}
            pending={pending}
            series={[
              seriesOf("luna", `Luna · ${regionName}`, "luna", result.moon, moonSlope),
              seriesOf("aqui", "Aquí", "aqui", result.earth, earthSlope),
            ]}
          />
          <p className="nc-nota">
            Los puntos marcan la pendiente típica de cada lugar. El límite del {percent(SLIP_LIMIT * 100)} es el que
            NASA exige a VIPER en 15° y el que usa el equipo de Curiosity.
          </p>
          {!result.earth.flat.reliable && (
            <p className="nc-aviso">
              Aquí la rueda se hunde más de un tercio de su radio: el modelo clásico pierde precisión con hundimientos
              tan grandes.
            </p>
          )}

          <section className="ruedas-bloque" aria-labelledby="ruedas-confianza">
            <h3 id="ruedas-confianza">¿Se puede confiar en el cálculo?</h3>
            <ul>
              <li>
                <strong>Carro lunar del Apolo 15, medido en la Luna:</strong> se hundió unos{" "}
                {decimal(REFERENCES.apollo15.sinkageCm, 2)} cm ({REFERENCES.apollo15.sinkageNote}), patinó un{" "}
                {REFERENCES.apollo15.slipPercent.join(" a ")} % y subió pendientes de{" "}
                {REFERENCES.apollo15.maxSlopeDeg.join(" a ")}°. El cálculo da{" "}
                {decimal(data.validation.apollo15.sinkageCm, 1)} cm, {decimal(data.validation.apollo15.slipPercent)} % y{" "}
                {decimal(data.validation.apollo15.maxSlopeDeg)}°.
              </li>
              <li>
                <strong>Versión aligerada de VIPER en el laboratorio de pendientes de NASA, en la Tierra:</strong> llegó
                a unos {REFERENCES.slopeLab.slopeAtLimit}° con un {percent(SLIP_LIMIT * 100)} de patinaje. El cálculo se
                queda en {decimal(data.validation.slopeLab.slopeAtLimit)}°: es conservador, porque no modela los tacos de
                la rueda.
              </li>
            </ul>
          </section>

          <section className="ruedas-bloque" aria-labelledby="ruedas-prueba">
            <h3 id="ruedas-prueba">Para probar aquí de verdad</h3>
            <p>
              Hay que usar el robot con su masa real. Un estudio con científicos de NASA (Hu y otros, 2025) muestra que
              las versiones aligeradas a un sexto, pensadas para imitar la gravedad lunar, dan resultados demasiado
              optimistas: en su simulación, la versión aligerada patinaba un 18 % en 10° y VIPER en la Luna, cerca de un
              75 %. Medir el suelo del lugar (con un bevámetro) cambiaría estos valores típicos por datos reales.
            </p>
          </section>

          <details className="ruedas-supuestos">
            <summary>Supuestos y fuentes</summary>
            <ul>
              <li>
                Modelo clásico de rueda rígida (Bekker, Janosi y Hanamoto, Wong y Reece): la rueda se trata como lisa,
                el peso se reparte por igual y todas las ruedas traccionan.
              </li>
              <li>
                Luna: {MOON_SOIL.detail.charAt(0).toLowerCase() + MOON_SOIL.detail.slice(1)}. Nadie ha medido el suelo
                del polo sur; cerca del polo podría ser más poroso.
              </li>
              <li>
                Aquí: un tipo de suelo publicado, no medido en este lugar.
              </li>
              {[...MOON_SOIL.assumed, ...soil.assumed, ...vehicle.notes]
                .filter((text, index, all) => all.indexOf(text) === index)
                .map((text) => (
                  <li key={text}>{text}</li>
                ))}
              <li>
                Es un modelo empírico: no recoge cómo la gravedad baja debilita el suelo granular, por eso la columna
                «Luna» es una estimación.
              </li>
            </ul>
            <ul className="ruedas-fuentes">
              {sources.map((source) => (
                <li key={source.url}>
                  <a href={source.url} target="_blank" rel="noreferrer">
                    {source.label}
                  </a>
                </li>
              ))}
            </ul>
          </details>
        </>
      ) : (
        <p className="nc-nota">Calculando la rueda en los dos suelos…</p>
      )}
    </div>
  );
}
