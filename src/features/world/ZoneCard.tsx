import { useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { Icon } from "../../components/Icon";
import { MissionCenter } from "../mission/MissionCenter";
import { PlaceBadge } from "../turnos/PlaceBadge";
import { TurnoPanel } from "../turnos/TurnoPanel";
import { usePlaceStatuses } from "../turnos/usePlaceStatuses";
import { ClimateTab } from "./ClimateTab";
import { AccessPanel } from "./AccessPanel";
import { coordinates, decimal, percent } from "./format";
import { HIGH_MATCH, MID_MATCH, similarity } from "./hierarchy";
import type { Match } from "./hierarchy";
import { surveyOf, zoneInfo } from "./lunar";
import type { LunarRegion } from "./lunar";
import { PhotoReading } from "./PhotoReading";
import { Photos } from "./Photos";
import { seasonOf } from "./climate";
import { Wheels } from "./Wheels";
import "./ficha.css";

const TABS = [
  { id: "terreno", name: "Terreno" },
  { id: "ruedas", name: "Ruedas" },
  { id: "clima", name: "Clima" },
  { id: "fotos", name: "Fotos" },
  { id: "turnos", name: "Turnos" },
] as const;
type Tab = (typeof TABS)[number]["id"];

/**
 * Ficha de un lugar, en cinco pestañas: la comparación de terreno, la rueda sobre el suelo (Luna
 * y aquí), el clima (temporada y ahora), las fotos y los turnos (si se puede reservar, días
 * ocupados y reserva). `region` llega cuando el terreno es real
 * (Luna); con Marte es una demostración. Se monta con `key` por lugar, así que cada lugar empieza
 * en la primera pestaña.
 */
interface Props {
  match: Match;
  region: LunarRegion | null;
  /** Agencia de quien tiene la sesión, para rellenar el plan de campaña. */
  institution: string;
}

export function ZoneCard({ match, region, institution }: Props) {
  const { zone, scenario } = match;
  const [tab, setTab] = useState<Tab>("terreno");
  const [mission, setMission] = useState(false);
  const tabsRef = useRef<HTMLDivElement>(null);
  const likeness = similarity(match.distance);
  // Área protegida, cerrado u ocupado hoy: se avisa arriba, sin tener que abrir la pestaña de turnos.
  const placeStatus = usePlaceStatuses().get(zone.id);
  const survey = surveyOf(zone.id);
  const elevation = survey?.elevation ?? null;
  const season = seasonOf(zone.id, zone.latitude, elevation);
  const rows = [
    { name: "Relieve", here: `${decimal(zone.relief)} m`, there: `${decimal(scenario.relief)} m` },
    { name: "Pendiente", here: `${decimal(zone.slope, 1)}°`, there: `${decimal(scenario.slope, 1)}°` },
    { name: "Rugosidad", here: `${decimal(zone.roughness, 1)} m`, there: `${decimal(scenario.roughness, 1)} m` },
  ];

  /** Las flechas cambian de pestaña, como en cualquier grupo de pestañas. */
  function onKeyDown(event: KeyboardEvent) {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const index = (TABS.findIndex((t) => t.id === tab) + step + TABS.length) % TABS.length;
    setTab(TABS[index].id);
    tabsRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[index]?.focus();
  }

  return (
    <article className="mundo-ficha">
      <span className={`nc-insignia acento similitud-${likeness.band}`}>{likeness.text}</span>
      <PlaceBadge status={placeStatus} />
      <h2>{zone.name}</h2>
      <p className="nc-texto-2">
        {zone.province}, {zone.country} · {coordinates(zone.latitude, zone.longitude)}
        {elevation !== null && ` · ${decimal(elevation)} m de altitud`}
      </p>

      <button type="button" className="nc-btn primario compacto ficha-mision" onClick={() => setMission(true)}>
        Planificar una campaña aquí <Icon name="arrow" size={16} />
      </button>
      {mission && (
        <MissionCenter
          match={match}
          real={Boolean(region)}
          season={season}
          institution={institution}
          onClose={() => setMission(false)}
        />
      )}

      <div className="ficha-pestanas" role="tablist" aria-label="Información del lugar" ref={tabsRef} onKeyDown={onKeyDown}>
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={`ficha-pestana-${item.id}`}
            aria-selected={tab === item.id}
            aria-controls={`ficha-panel-${item.id}`}
            tabIndex={tab === item.id ? 0 : -1}
            onClick={() => setTab(item.id)}
          >
            {item.name}
          </button>
        ))}
      </div>

      <div className="ficha-panel" role="tabpanel" id={`ficha-panel-${tab}`} aria-labelledby={`ficha-pestana-${tab}`}>
        {tab === "terreno" && (
          <>
            <dl className="mundo-distancia">
              <div>
                <dt>{region ? "Se compara con" : "Se parece más a"}</dt>
                <dd>
                  {scenario.name} <small>{scenario.world}</small>
                </dd>
              </div>
              <div>
                <dt>{region ? "Coincidencia de terreno" : "Coincidencia ilustrativa"}</dt>
                <dd>
                  <span className="mono">{likeness.percent} %</span> <small>similitud {likeness.name.toLowerCase()}</small>
                </dd>
              </div>
            </dl>
            <table>
              <thead>
                <tr>
                  <th scope="col">Descriptor</th>
                  <th scope="col">Aquí</th>
                  <th scope="col">{scenario.name}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.name}>
                    <th scope="row">{row.name}</th>
                    <td>{row.here}</td>
                    <td>{row.there}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {region && survey ? (
              <>
                <p className="nc-nota">
                  <strong>Datos reales.</strong> Valor típico (mediana) de{" "}
                  {region.resolutionM === 30 ? survey.windows : survey.coarseWindows} ventanas de 3 km en el recuadro
                  de 18 km que se ve en el mapa (Copernicus {survey.dem}
                  {region.resolutionM === 30 ? ", 30 m" : `, promediado a ${region.resolutionM} m`}) y de{" "}
                  {region.windows} ventanas en {region.name} ({zoneInfo(region.zone).instrument}).
                  {survey.water >= 0.01 && ` El ${percent(survey.water)} del área es agua y no entra en el cálculo.`}
                </p>
                <p className="nc-nota">
                  <strong>Cómo se calcula la coincidencia.</strong> Sale de la distancia de terreno (
                  {match.distance.toFixed(3)}): 100 % sería el mismo relieve, pendiente y rugosidad, y baja un punto
                  por cada centésima de distancia. La similitud es alta con {HIGH_MATCH} % o más, media de {MID_MATCH}{" "}
                  a {HIGH_MATCH - 1} % y baja con menos de {MID_MATCH} %.
                </p>
                <p className="nc-nota">
                  Solo se compara la forma del terreno. Ningún lugar de la Tierra reproduce el vacío, la gravedad
                  lunar (un sexto de la terrestre), la radiación ni las temperaturas de la Luna.
                </p>
              </>
            ) : (
              <p className="nc-nota">Valores sintéticos de ejemplo: no son mediciones de este lugar.</p>
            )}
            <AccessPanel placeId={zone.id} />
          </>
        )}

        {tab === "ruedas" &&
          (region ? (
            <Wheels
              placeId={zone.id}
              latitude={zone.latitude}
              longitude={zone.longitude}
              placeSlope={zone.slope}
              regionName={scenario.name}
              regionSlope={scenario.slope}
            />
          ) : (
            <p className="nc-nota">
              La rueda sobre el suelo se calcula con la Luna, que tiene terreno y suelo con datos publicados. Marte es
              por ahora una demostración.
            </p>
          ))}

        {tab === "clima" && (
          <ClimateTab
            zoneId={zone.id}
            latitude={zone.latitude}
            longitude={zone.longitude}
            elevation={elevation}
            season={season}
            region={region ? { id: region.id, name: scenario.name } : null}
          />
        )}

        {tab === "fotos" && (
          <>
            <PhotoReading placeId={zone.id} />
            <Photos latitude={zone.latitude} longitude={zone.longitude} />
            <div className="ficha-enlaces">
              <a
                className="mundo-osm"
                href={`https://www.google.com/maps/@?api=1&map_action=map&center=${zone.latitude},${zone.longitude}&zoom=12&basemap=satellite`}
                target="_blank"
                rel="noreferrer"
              >
                Abrir en Google Maps
                <Icon name="arrow" size={14} />
              </a>
              <a
                className="mundo-osm"
                href={`https://www.openstreetmap.org/?mlat=${zone.latitude}&mlon=${zone.longitude}#map=11/${zone.latitude}/${zone.longitude}`}
                target="_blank"
                rel="noreferrer"
              >
                Abrir en OpenStreetMap
                <Icon name="arrow" size={14} />
              </a>
            </div>
          </>
        )}

        {tab === "turnos" && <TurnoPanel placeId={zone.id} />}
      </div>
    </article>
  );
}
