import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Copilot } from "../ai/Copilot";
import { decimal } from "../world/format";
import type { Season } from "../world/climate";
import { similarity } from "../world/hierarchy";
import type { Match } from "../world/hierarchy";
import { quarterStart, toIsoDate } from "../../services/turnosRules";
import { TurnoPanel } from "../turnos/TurnoPanel";
import { PLAN_NOTES, WINDOW_STATUS, missionCode, planText, quarters, robotOutcomeAfter } from "./campaign";
import type { MissionPlan, RobotTestResult } from "./campaign";
import { ASSUMPTION_LABELS, CITIES, DEFAULT_ASSUMPTIONS, LIMITS, estimateCampaign, haversineKm, usd } from "./cost";
import type { Assumptions } from "./cost";
import { MOON_GRAVITY, RESOLUTIONS, TERRAIN_SOURCE, download, fetchTerrain, fileSlug, terrainStats, toObj, toPackage } from "./twin";
import type { TerrainGrid } from "./twin";
import "./mission.css";

// El simulador 3D (Three.js y los modelos de los robots) se descarga solo al abrir su pestaña.
const RobotTest = lazy(() => import("./RobotTest").then((module) => ({ default: module.RobotTest })));

const TABS = [
  { id: "gemelo", name: "Gemelo digital" },
  { id: "robot", name: "Prueba del robot" },
  { id: "costo", name: "Costo desde tu ubicación" },
  { id: "plan", name: "Ventana y plan" },
  { id: "copiloto", name: "Copiloto IA" },
] as const;
type Tab = (typeof TABS)[number]["id"];

/** Lado del área que se exporta: el mismo recuadro de 18 km que se analiza y se ve en el mapa. */
const AREA_M = 18_000;

/** Momento en que se genera un archivo o un plan. */
const timestamp = () => new Date().toISOString();

type TwinState = { status: "cargando" } | { status: "error" } | { status: "listo"; grid: TerrainGrid };
type Origin = { name: string; latitude: number; longitude: number };
type GeoState = "inactivo" | "buscando" | "denegado" | "sin-soporte";

const PREVIEW_EXAGGERATION = 4;

/**
 * Dónde se monta el panel: en la raíz de la pantalla, fuera de la lista de localidades,
 * para que los estilos de la lista no se le apliquen.
 */
const portalTarget = () => document.querySelector(".nocturno") ?? document.body;

/** Relieve sombreado de la malla, con el norte arriba. */
function drawPreview(canvas: HTMLCanvasElement, grid: TerrainGrid) {
  const points = grid.cells + 1;
  const cell = grid.sizeM / grid.cells;
  canvas.width = points;
  canvas.height = points;
  const context = canvas.getContext("2d");
  if (!context) return;
  const image = context.createImageData(points, points);
  const at = (row: number, col: number) =>
    grid.heights[Math.min(points - 1, Math.max(0, row)) * points + Math.min(points - 1, Math.max(0, col))];
  for (let row = 0; row < points; row++) {
    for (let col = 0; col < points; col++) {
      // Solo en la vista previa el relieve se exagera, para que se lea en una imagen pequeña.
      const dx = ((at(row, col + 1) - at(row, col - 1)) / (2 * cell)) * PREVIEW_EXAGGERATION;
      const dy = ((at(row + 1, col) - at(row - 1, col)) / (2 * cell)) * PREVIEW_EXAGGERATION;
      // Luz desde el noroeste, a 45° de altura.
      const shade = (0.5 * dx - 0.5 * dy + 0.707) / Math.sqrt(dx * dx + dy * dy + 1);
      const value = Math.round(Math.min(1, Math.max(0, shade * 1.25 - 0.22)) * 255);
      const offset = ((points - 1 - row) * points + col) * 4;
      image.data[offset] = value;
      image.data[offset + 1] = value;
      image.data[offset + 2] = Math.min(255, value + 6);
      image.data[offset + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
}

interface Props {
  match: Match;
  /** true cuando el terreno comparado es real (Luna); con Marte es una demostración. */
  real: boolean;
  season: Season | null;
  /** Nombre de la agencia de quien tiene la sesión, para el plan. */
  institution: string;
  onClose: () => void;
}

/**
 * Centro de misión de un lugar: descarga su gemelo digital, estima el costo de llegar desde
 * donde está el equipo y arma un plan de campaña para una temporada.
 */
export function MissionCenter({ match, real, season, institution, onClose }: Props) {
  const { zone, scenario } = match;
  const dialogRef = useRef<HTMLDialogElement>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [tab, setTab] = useState<Tab>("gemelo");

  // ---------- Gemelo digital ----------
  const [cells, setCells] = useState<number>(RESOLUTIONS[1].cells);
  const [twin, setTwin] = useState<TwinState>({ status: "cargando" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchTerrain(zone.latitude, zone.longitude, AREA_M, cells)
      .then((grid) => !cancelled && setTwin({ status: "listo", grid }))
      .catch(() => !cancelled && setTwin({ status: "error" }));
    return () => {
      cancelled = true;
    };
  }, [zone.latitude, zone.longitude, cells, attempt]);

  const grid = twin.status === "listo" && twin.grid.cells === cells ? twin.grid : null;
  useEffect(() => {
    if (grid && canvasRef.current) drawPreview(canvasRef.current, grid);
  }, [grid, tab]);
  const stats = useMemo(() => (grid ? terrainStats(grid) : null), [grid]);

  function chooseResolution(next: number) {
    if (next === cells) return;
    setTwin({ status: "cargando" });
    setCells(next);
  }

  function retryTwin() {
    setTwin({ status: "cargando" });
    setAttempt((n) => n + 1);
  }

  const site = { name: zone.name, latitude: zone.latitude, longitude: zone.longitude };
  const slug = fileSlug(zone.name);

  function downloadObj() {
    if (grid) download(`${slug}-${cells}.obj`, toObj(grid, site, timestamp()), "text/plain");
  }

  function downloadPackage() {
    if (!grid) return;
    const reference = real
      ? { name: scenario.name, relief: scenario.relief, slope: scenario.slope, roughness: scenario.roughness }
      : null;
    const pack = toPackage(grid, site, reference, timestamp());
    download(`${slug}-${cells}-simulacion.json`, JSON.stringify(pack), "application/json");
  }

  // ---------- Costo ----------
  const [origin, setOrigin] = useState<Origin>(CITIES[1]);
  const [geo, setGeo] = useState<GeoState>("inactivo");
  const [people, setPeople] = useState(4);
  const [cargoKg, setCargoKg] = useState(150);
  const [days, setDays] = useState(10);
  const [assumptions, setAssumptions] = useState<Assumptions>(DEFAULT_ASSUMPTIONS);

  /** La ubicación solo se pide al pulsar el botón y no sale de este navegador. */
  function locate() {
    if (!("geolocation" in navigator)) {
      setGeo("sin-soporte");
      return;
    }
    setGeo("buscando");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setOrigin({ name: "Mi ubicación", latitude: position.coords.latitude, longitude: position.coords.longitude });
        setGeo("inactivo");
      },
      () => setGeo("denegado"),
      { maximumAge: 600_000, timeout: 15_000 },
    );
  }

  // ---------- Ventana y plan ----------
  const windows = useMemo(() => (season ? quarters(season.year) : []), [season]);
  const [today] = useState(() => new Date());
  const [quarter, setQuarter] = useState(() => {
    const best = windows.findIndex((w) => w.status === "optima");
    return best >= 0 ? best : Math.max(0, windows.findIndex((w) => w.status === "exigente"));
  });
  const [year, setYear] = useState(() => today.getFullYear() + 1);
  const [mission, setMission] = useState("");
  const [agency, setAgency] = useState(institution);
  const [plan, setPlan] = useState<MissionPlan | null>(null);
  // ---------- Prueba del robot ----------
  const [robotTest, setRobotTest] = useState<RobotTestResult | null>(null);

  const chosen = windows[quarter] ?? null;
  const seasonFactor = chosen ? WINDOW_STATUS[chosen.status].factor : 1;
  const distanceKm = haversineKm(origin, zone);
  const cost = estimateCampaign({ distanceKm, people, cargoKg, days, seasonFactor }, assumptions);
  const parts = [
    { name: "Pasajes del equipo, ida y vuelta", value: cost.flights },
    { name: "Carga: robot, baterías e instrumentos", value: cost.cargo },
    { name: "Trabajo de campo: campamento, comida, vehículos", value: cost.field },
    { name: "Permisos y seguros", value: cost.permits },
    { name: "Imprevistos", value: cost.contingency },
  ];
  const largest = Math.max(...parts.map((p) => p.value), 1);

  function makePlan() {
    setPlan({
      code: missionCode(year),
      generatedAt: timestamp(),
      mission: mission.trim() || "Campaña análoga",
      institution: agency.trim() || "Sin institución",
      site: { name: zone.name, province: zone.province, country: zone.country, latitude: zone.latitude, longitude: zone.longitude },
      reference: { name: scenario.name, world: scenario.world, distance: match.distance, real },
      window: chosen && {
        year,
        quarter: chosen.name,
        status: WINDOW_STATUS[chosen.status].name,
        reasons: chosen.reasons,
      },
      team: { origin: origin.name, distanceKm, people, cargoKg, days },
      cost,
      robotTest,
      notes: PLAN_NOTES,
    });
  }

  /** Las flechas cambian de pestaña. */
  function onTabKey(event: KeyboardEvent) {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const index = (TABS.findIndex((t) => t.id === tab) + step + TABS.length) % TABS.length;
    setTab(TABS[index].id);
    tabsRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[index]?.focus();
  }

  const number = (value: string, fallback: number) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  return createPortal(
    <dialog
      // La prueba del robot es un simulador a pantalla completa: el panel se abre del todo.
      className={tab === "robot" ? "mision mision-simulador" : "mision"}
      ref={dialogRef}
      aria-labelledby="mision-titulo"
      onCancel={(event) => {
        // En el simulador, Escape no cierra el centro de misión: se perdería la prueba en curso.
        // Se sale con el botón de cerrar o cambiando de pestaña.
        if (tab === "robot") event.preventDefault();
      }}
      onClose={onClose}
      onClick={(event) => event.target === dialogRef.current && dialogRef.current.close()}
    >
      <div className="mision-caja">
        <header className="mision-cabecera">
          <div>
            <span className="nc-eyebrow">Centro de misión</span>
            <h2 id="mision-titulo">{zone.name}</h2>
            <p className="nc-nota">
              {zone.province}, {zone.country} · comparado con {scenario.name} ({scenario.world}) ·{" "}
              {similarity(match.distance).text.toLowerCase()}
              {!real && " (demostración)"}
            </p>
          </div>
          <button type="button" className="mision-cerrar" aria-label="Cerrar el centro de misión" onClick={() => dialogRef.current?.close()}>
            ✕
          </button>
        </header>

        <div className="mision-pestanas" role="tablist" aria-label="Centro de misión" ref={tabsRef} onKeyDown={onTabKey}>
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              id={`mision-pestana-${item.id}`}
              aria-selected={tab === item.id}
              aria-controls={`mision-panel-${item.id}`}
              tabIndex={tab === item.id ? 0 : -1}
              onClick={() => setTab(item.id)}
            >
              {item.name}
            </button>
          ))}
        </div>

        <div className="mision-panel" role="tabpanel" id={`mision-panel-${tab}`} aria-labelledby={`mision-pestana-${tab}`}>
          {tab === "gemelo" && (
            <div className="mision-gemelo">
              <div className="mision-vista">
                <canvas ref={canvasRef} aria-label={`Relieve sombreado de ${zone.name}, con el norte arriba`} role="img" />
                {twin.status === "cargando" && <p>Leyendo la elevación real del lugar…</p>}
                {twin.status === "error" && (
                  <p role="alert">
                    No se pudo leer la elevación. Revisa la conexión.
                    <button type="button" onClick={retryTwin}>
                      Reintentar
                    </button>
                  </p>
                )}
              </div>
              <div className="mision-opciones">
                <p className="nc-texto-2">
                  El relieve real de los {AREA_M / 1000} km analizados, como malla 3D para probar un robot en un
                  simulador antes de viajar.
                </p>
                <fieldset>
                  <legend>Resolución de la malla</legend>
                  {RESOLUTIONS.map((option) => (
                    <label key={option.cells} className="mision-radio">
                      <input
                        type="radio"
                        name="mision-resolucion"
                        checked={cells === option.cells}
                        onChange={() => chooseResolution(option.cells)}
                      />
                      <span>
                        <strong>{option.name}</strong> · {option.cells} × {option.cells} · celdas de{" "}
                        {decimal(AREA_M / option.cells)} m
                      </span>
                    </label>
                  ))}
                </fieldset>
                <dl className="mision-datos">
                  <div>
                    <dt>Altitud</dt>
                    <dd>{stats ? `${decimal(stats.minM)} a ${decimal(stats.maxM)} m` : "—"}</dd>
                  </div>
                  <div>
                    <dt>Relieve</dt>
                    <dd>{stats ? `${decimal(stats.reliefM)} m` : "—"}</dd>
                  </div>
                  <div>
                    <dt>Pendiente media</dt>
                    <dd>{stats ? `${decimal(stats.slopeMeanDeg, 1)}°` : "—"}</dd>
                  </div>
                  <div>
                    <dt>Pendiente del 95 %</dt>
                    <dd>{stats ? `hasta ${decimal(stats.slopeP95Deg, 1)}°` : "—"}</dd>
                  </div>
                </dl>
                <div className="mision-botones">
                  <button type="button" className="nc-btn primario compacto" disabled={!grid} onClick={downloadObj}>
                    Descargar malla 3D (.obj)
                  </button>
                  <button type="button" className="nc-btn secundario compacto" disabled={!grid} onClick={downloadPackage}>
                    Descargar paquete de simulación (.json)
                  </button>
                </div>
                <ul className="nc-nota mision-notas">
                  <li>Malla en metros, con Z hacia arriba y sin exagerar: se importa en Gazebo, Isaac Sim, Unity o Blender.</li>
                  <li>
                    El paquete trae el mapa de alturas, las pendientes y la gravedad lunar ({decimal(MOON_GRAVITY, 2)} m/s²).
                  </li>
                  <li>
                    Fricción, cohesión y densidad del suelo van vacías: no hay ensayos de campo y no se inventan.
                  </li>
                  <li>
                    Elevación:{" "}
                    <a href={TERRAIN_SOURCE.url} target="_blank" rel="noreferrer">
                      {TERRAIN_SOURCE.name}
                    </a>
                    {grid && `, a ${decimal(grid.sourcePixelM)} m por píxel`}.
                  </li>
                </ul>
              </div>
            </div>
          )}

          {tab === "robot" && (
            <Suspense fallback={<p className="nc-nota mision-cargando">Abriendo el simulador…</p>}>
              <RobotTest
                site={{ id: zone.id, name: zone.name, latitude: zone.latitude, longitude: zone.longitude }}
                reference={real ? scenario : null}
                added={robotTest}
                onAdd={(result) => {
                  setRobotTest(result);
                  setPlan(null);
                }}
                onClose={() => dialogRef.current?.close()}
              />
            </Suspense>
          )}

          {tab === "costo" && (
            <div className="mision-costo">
              <div className="mision-formulario">
                <label className="nc-campo">
                  <span>Punto de salida del equipo</span>
                  <select
                    id="mision-origen"
                    value={origin.name}
                    onChange={(e) => setOrigin(CITIES.find((c) => c.name === e.target.value) ?? origin)}
                  >
                    {origin.name === "Mi ubicación" && <option value="Mi ubicación">Mi ubicación</option>}
                    {CITIES.map((city) => (
                      <option key={city.name} value={city.name}>
                        {city.name}, {city.country}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="button" className="nc-btn secundario compacto" onClick={locate} disabled={geo === "buscando"}>
                  {geo === "buscando" ? "Buscando…" : "Usar mi ubicación"}
                </button>
                {geo === "denegado" && <p className="nc-nota">El navegador no compartió la ubicación. Elige una ciudad de la lista.</p>}
                {geo === "sin-soporte" && <p className="nc-nota">Este navegador no ofrece ubicación. Elige una ciudad de la lista.</p>}
                <p className="mision-distancia">
                  <strong>{decimal(distanceKm)} km</strong> hasta {zone.name}, en línea recta sobre el globo.
                </p>

                <label className="nc-campo">
                  <span>
                    Personas en el equipo: <strong>{people}</strong>
                  </span>
                  <input
                    id="mision-personas"
                    type="range"
                    min={LIMITS.people[0]}
                    max={LIMITS.people[1]}
                    value={people}
                    onChange={(e) => setPeople(number(e.target.value, people))}
                  />
                </label>
                <div className="mision-par">
                  <label className="nc-campo">
                    <span>Carga del robot (kg)</span>
                    <input
                      id="mision-carga"
                      type="number"
                      min={LIMITS.cargoKg[0]}
                      max={LIMITS.cargoKg[1]}
                      value={cargoKg}
                      onChange={(e) => setCargoKg(number(e.target.value, cargoKg))}
                    />
                  </label>
                  <label className="nc-campo">
                    <span>Días en campo</span>
                    <input
                      id="mision-dias"
                      type="number"
                      min={LIMITS.days[0]}
                      max={LIMITS.days[1]}
                      value={days}
                      onChange={(e) => setDays(number(e.target.value, days))}
                    />
                  </label>
                </div>
                <p className="nc-nota">
                  {chosen
                    ? `Temporada elegida: ${chosen.name}, ${WINDOW_STATUS[chosen.status].name.toLowerCase()}${seasonFactor > 1 ? ` (trabajo de campo ×${decimal(seasonFactor, 2)})` : " (sin recargo)"}. Se cambia en «Ventana y plan».`
                    : "Sin clima típico para este lugar: no se aplica recargo de temporada."}
                </p>
                <p className="nc-nota">Tu ubicación solo se usa para calcular la distancia y no sale de este navegador.</p>
              </div>

              <div className="mision-desglose">
                <p className="mision-total">
                  <span>Inversión total estimada</span>
                  <strong>{usd(cost.total)}</strong>
                  <small>{usd(cost.perDay)} por día de ensayo</small>
                </p>
                <ul>
                  {parts.map((part) => (
                    <li key={part.name}>
                      <span>{part.name}</span>
                      <span className="mision-barra" aria-hidden="true">
                        <i style={{ width: `${(part.value / largest) * 100}%` }} />
                      </span>
                      <strong>{usd(part.value)}</strong>
                    </li>
                  ))}
                </ul>
                <details className="mision-supuestos">
                  <summary>Tarifas de ejemplo (se pueden cambiar)</summary>
                  <div>
                    {(Object.keys(ASSUMPTION_LABELS) as (keyof Assumptions)[]).map((key) => (
                      <label key={key} className="nc-campo">
                        <span>{ASSUMPTION_LABELS[key]}</span>
                        <input
                          type="number"
                          min={0}
                          step="any"
                          value={assumptions[key]}
                          onChange={(e) => setAssumptions({ ...assumptions, [key]: number(e.target.value, assumptions[key]) })}
                        />
                      </label>
                    ))}
                  </div>
                  <button type="button" className="nc-btn secundario compacto" onClick={() => setAssumptions(DEFAULT_ASSUMPTIONS)}>
                    Volver a las tarifas de ejemplo
                  </button>
                </details>
                <p className="nc-aviso">
                  <b>OJO</b>
                  <span>
                    Es una estimación con tarifas de ejemplo para comparar lugares, no una cotización. Presupuesta la
                    campaña en la Tierra, no una misión espacial.
                  </span>
                </p>
              </div>
            </div>
          )}

          {tab === "plan" && (
            <div className="mision-plan">
              {windows.length > 0 ? (
                <fieldset className="mision-ventanas">
                  <legend>Ventana de campaña, según el clima típico del lugar</legend>
                  {windows.map((window) => {
                    const status = WINDOW_STATUS[window.status];
                    return (
                      <label key={window.index} className={`mision-ventana ${window.status}`}>
                        <input
                          type="radio"
                          name="mision-ventana"
                          checked={quarter === window.index}
                          onChange={() => {
                            setQuarter(window.index);
                            setPlan(null);
                          }}
                        />
                        <strong>{window.name}</strong>
                        <span className="mision-estado">
                          <i aria-hidden="true">{status.symbol}</i>
                          {status.name}
                        </span>
                        <span>
                          {decimal(window.temperatureMin)} a {decimal(window.temperatureMax)} °C · {decimal(window.precipitation)} mm
                        </span>
                        <small>{window.reasons.length ? window.reasons.join(", ") : "sin inconvenientes"}</small>
                      </label>
                    );
                  })}
                </fieldset>
              ) : (
                <p className="nc-nota">Este lugar aún no tiene clima típico calculado: el plan se genera sin ventana.</p>
              )}
              {chosen && <p className="nc-nota">{WINDOW_STATUS[chosen.status].detail}</p>}

              <div className="mision-formulario mision-plan-datos">
                <label className="nc-campo">
                  <span>Año</span>
                  <select id="mision-anio" value={year} onChange={(e) => setYear(Number(e.target.value))}>
                    {[0, 1, 2].map((offset) => (
                      <option key={offset} value={today.getFullYear() + offset}>
                        {today.getFullYear() + offset}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="nc-campo">
                  <span>Nombre de la misión</span>
                  <input id="mision-nombre" value={mission} placeholder="Prueba de movilidad del rover" onChange={(e) => setMission(e.target.value)} />
                </label>
                <label className="nc-campo">
                  <span>Institución</span>
                  <input id="mision-institucion" value={agency} onChange={(e) => setAgency(e.target.value)} />
                </label>
                <button type="button" className="nc-btn primario compacto" onClick={makePlan}>
                  Generar plan de campaña
                </button>
              </div>

              {plan && (
                <section className="mision-pase" aria-live="polite">
                  <header>
                    <span>Plan de campaña</span>
                    <code>{plan.code}</code>
                  </header>
                  <dl>
                    <div>
                      <dt>Misión</dt>
                      <dd>{plan.mission}</dd>
                    </div>
                    <div>
                      <dt>Institución</dt>
                      <dd>{plan.institution}</dd>
                    </div>
                    <div>
                      <dt>Ventana</dt>
                      <dd>{plan.window ? `${plan.window.quarter} de ${plan.window.year} · ${plan.window.status}` : "Sin ventana"}</dd>
                    </div>
                    <div>
                      <dt>Equipo</dt>
                      <dd>
                        {plan.team.people} personas, {plan.team.cargoKg} kg, {plan.team.days} días, desde {plan.team.origin}
                      </dd>
                    </div>
                    <div>
                      <dt>Costo estimado</dt>
                      <dd>{usd(plan.cost.total)}</dd>
                    </div>
                    <div>
                      <dt>Prueba del robot</dt>
                      <dd>
                        {plan.robotTest
                          ? `${plan.robotTest.vehicle}: ${robotOutcomeAfter(plan.robotTest, `${decimal(plan.robotTest.distanceM, 1)} m`)} · inicio ${plan.robotTest.start.latitude}, ${plan.robotTest.start.longitude}`
                          : "Sin prueba: hazla en «Prueba del robot» y añádela al plan."}
                      </dd>
                    </div>
                  </dl>
                  <div className="mision-botones">
                    <button type="button" className="nc-btn secundario compacto" onClick={() => download(`${plan.code}.txt`, planText(plan), "text/plain")}>
                      Descargar plan (.txt)
                    </button>
                    <button
                      type="button"
                      className="nc-btn secundario compacto"
                      onClick={() => download(`${plan.code}.json`, JSON.stringify(plan, null, 2), "application/json")}
                    >
                      Descargar plan (.json)
                    </button>
                  </div>
                  <p className="nc-nota">
                    Es un documento de planificación y no equivale a un permiso. Para apartar el lugar, reserva el
                    turno aquí abajo. El equipo, la carga y los días se ajustan en «Costo desde tu ubicación».
                  </p>
                </section>
              )}
              {plan && (
                <section className="mision-turno" aria-label="Turno para este plan">
                  <TurnoPanel
                    key={plan.code}
                    placeId={zone.id}
                    plan={{
                      start: quarterStart(
                        plan.window?.year ?? today.getFullYear(),
                        windows.find((w) => w.name === plan.window?.quarter)?.index ?? null,
                        toIsoDate(today),
                      ),
                      days: plan.team.days,
                      mission: plan.mission,
                      robot: plan.robotTest?.vehicle ?? null,
                      people: plan.team.people,
                      costUsd: plan.cost.total,
                    }}
                  />
                </section>
              )}
            </div>
          )}

          {tab === "copiloto" && <Copilot match={match} real={real} season={season} robotTest={robotTest} plan={plan} />}
        </div>
      </div>
    </dialog>,
    portalTarget(),
  );
}
