import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AccountBar } from "../../components/AccountBar";
import type { User } from "../../services/auth";
import { GestureCamera } from "../gestos/GestureCamera";
import { emptyHoloTrack, holoFromHands } from "../gestos/gestures";
import type { HandReading, HoloGestureState } from "../gestos/gestures";
import { ROBOTS, ROBOT_GROUPS, robotById } from "../mission/robots";
import { decimal } from "../world/format";
import { HANGAR_CHECKED, dateText, hangarOf, isPlanned, periodText } from "./hangarData";
import type { PartInfo } from "./hangarData";
import { createHoloScene } from "./holoScene";
import type { HoloScene, HoloStyle } from "./holoScene";
import { preferredRobot, readLog, setPreferredRobot, summarize } from "./logbook";
import type { LogEntry, LogSummary } from "./logbook";
import { ROBOT_PARTS, isHoloRobot } from "./parts";
import "./hangar.css";

type Tab = "componentes" | "historial";
type Stage = "cargando" | "listo" | "error";

/** Lo que se enseña por cada gesto que mueve el holograma. */
const GESTURE_TEXT: Record<HoloGestureState, { icon: string; text: string }> = {
  "sin-mano": { icon: "…", text: "Muestra una mano a la cámara" },
  girar: { icon: "✋", text: "Lo giras: mueve la mano" },
  desarmar: { icon: "🤲", text: "Dos manos: sepáralas o júntalas" },
  pausa: { icon: "✊", text: "Suelto: recoloca la mano" },
  senalar: { icon: "☝️", text: "Señalando: siguiente componente" },
  espera: { icon: "?", text: "Gesto sin reconocer" },
};

/** Qué dato de las pruebas del simulador toca a cada componente. */
const USAGE: Record<string, (summary: LogSummary) => string> = {
  ruedas: (s) => `En tus pruebas, sus ruedas patinaron como máximo un ${s.worstSlip.percent} % (${s.worstSlip.siteName}).`,
  suspension: (s) => `En tus pruebas, la pendiente más fuerte que enfrentó fue de ${decimal(s.steepest.degrees, 1)}° (${s.steepest.siteName}).`,
  rtg: (s) => `En tus pruebas gastó ${decimal(s.energyWh, 1)} Wh en total.`,
  paneles: (s) => `En tus pruebas gastó ${decimal(s.energyWh, 1)} Wh en total.`,
  baterias: (s) => `En tus pruebas gastó ${decimal(s.energyWh, 1)} Wh en total.`,
  cuerpo: (s) => `En tus pruebas se topó ${s.collisions} ${s.collisions === 1 ? "vez" : "veces"} con obstáculos.`,
  bastidor: (s) => `En tus pruebas se topó ${s.collisions} ${s.collisions === 1 ? "vez" : "veces"} con obstáculos.`,
};

const outcomeText = (entry: LogEntry) => (entry.outcome === "atascado" ? "Se atascó" : entry.reachedTarget ? "Llegó al destino" : "Prueba terminada");

const initialRobot = () => {
  const wanted = preferredRobot();
  return ROBOTS.some((robot) => robot.id === wanted) ? wanted! : "perseverance";
};

/**
 * Hangar: cada robot del catálogo, visto como un holograma que se gira, se desarma y se recorre
 * pieza a pieza. De cada componente se cuenta qué es, sus datos publicados y en qué otras misiones
 * voló («herencia de vuelo»); de cada robot, su historial real y las pruebas hechas en el simulador.
 * El holograma también se mueve con las manos, ante la cámara.
 */
export default function Hangar({ user }: { user: User }) {
  const [calm] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [robotId, setRobotId] = useState(initialRobot);
  const [tab, setTab] = useState<Tab>("componentes");
  const [selected, setSelected] = useState<string | null>(null);
  const [explode, setExplode] = useState(0);
  const [style, setStyle] = useState<HoloStyle>("holograma");
  const [spin, setSpin] = useState(!calm);
  const [stage, setStage] = useState<Stage>("cargando");
  /** Componentes que el modelo 3D trae como piezas separadas. */
  const [pieces, setPieces] = useState<string[]>([]);
  const [gestures, setGestures] = useState(false);
  const [gestureNow, setGestureNow] = useState<{ state: HoloGestureState; progress: number }>({ state: "sin-mano", progress: 0 });
  /** Las pruebas del simulador de esta cuenta: se leen al entrar (se hacen en otra pantalla). */
  const [log] = useState(() => readLog(user.email));

  const robot = robotById(robotId);
  const info = hangarOf(robotId);
  const holo = isHoloRobot(robotId);
  const order = holo ? ROBOT_PARTS[robotId] : [];
  const runs = useMemo(() => log.filter((entry) => entry.robot === robotId), [log, robotId]);
  const summary = useMemo(() => summarize(runs), [runs]);

  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<HoloScene | null>(null);
  const labelsRef = useRef(new Map<string, HTMLButtonElement>());
  const trackRef = useRef(emptyHoloTrack());
  /** Lo último elegido, para aplicarlo a la escena cuando termina de cargar un robot. */
  const viewRef = useRef({ explode, style, selected, spin: spin && !gestures });
  const nextRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    viewRef.current = { explode, style, selected, spin: spin && !gestures };
    nextRef.current = () => {
      const available = order.filter((part) => info?.components[part]);
      if (!available.length) return;
      const at = selected ? available.indexOf(selected) : -1;
      setSelected(available[(at + 1) % available.length]);
      setTab("componentes");
    };
  });

  // La escena se crea una vez y vive mientras el hangar está abierto.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const scene = createHoloScene(container, { calm });
    sceneRef.current = scene;
    scene.onPick = (part) => {
      setSelected(part);
      if (part) setTab("componentes");
    };
    // Las etiquetas siguen a sus piezas en cada imagen: se mueven a mano, sin pasar por React.
    scene.onAnchors = (anchors) => {
      const width = container.clientWidth;
      for (const [part, label] of labelsRef.current) {
        const anchor = anchors[part];
        if (!anchor?.visible) {
          label.style.visibility = "hidden";
          continue;
        }
        // Cerca del borde derecho el nombre no cabría: se despliega hacia la izquierda.
        const flip = anchor.x > width - 190;
        label.classList.toggle("al-reves", flip);
        label.style.visibility = "visible";
        label.style.transform = `translate(${Math.round(anchor.x)}px, ${Math.round(anchor.y)}px)${flip ? " translateX(-100%)" : ""}`;
      }
    };
    return () => {
      scene.dispose();
      sceneRef.current = null;
    };
  }, [calm]);

  // Otro robot: se carga su holograma (o se vacía el escenario si no tiene forma 3D).
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    if (!isHoloRobot(robotId)) {
      scene.clear();
      return;
    }
    let cancelled = false;
    scene.load(robotId).then(
      (loaded) => {
        if (cancelled) return;
        const view = viewRef.current;
        scene.setStyle(view.style);
        scene.setExplode(view.explode);
        scene.setSelected(view.selected);
        scene.setAutoRotate(view.spin);
        setPieces(loaded.parts);
        setStage("listo");
      },
      () => {
        if (!cancelled) setStage("error");
      },
    );
    return () => {
      cancelled = true;
    };
  }, [robotId]);

  useEffect(() => sceneRef.current?.setExplode(explode), [explode]);
  useEffect(() => sceneRef.current?.setStyle(style), [style]);
  useEffect(() => sceneRef.current?.setSelected(selected), [selected]);
  // Con las manos al mando, el holograma no gira solo: lo mueve quien lo mira.
  useEffect(() => sceneRef.current?.setAutoRotate(spin && !gestures), [spin, gestures]);

  function chooseRobot(id: string) {
    if (id === robotId) return;
    setRobotId(id);
    setSelected(null);
    setExplode(0);
    setPieces([]);
    setStage("cargando");
    setTab(isHoloRobot(id) ? "componentes" : "historial");
  }

  function pick(part: string | null) {
    setSelected(part);
    if (part) setTab("componentes");
  }

  /** Cada lectura de la cámara: girar con una mano, desarmar con dos, señalar para pasar de pieza. */
  const onHands = useCallback((hands: HandReading[], now: number) => {
    const { command, track } = holoFromHands(hands, trackRef.current, now);
    trackRef.current = track;
    if (command.yaw !== 0 || command.pitch !== 0) sceneRef.current?.rotateBy(command.yaw, command.pitch);
    if (command.explode !== null) {
      const amount = command.explode;
      setExplode((shown) => (Math.abs(shown - amount) < 0.015 ? shown : amount));
    }
    if (command.next) nextRef.current();
    const progress = Math.round(command.pointProgress * 5) / 5;
    setGestureNow((shown) => (shown.state === command.state && shown.progress === progress ? shown : { state: command.state, progress }));
  }, []);

  function toggleGestures() {
    trackRef.current = emptyHoloTrack();
    setGestureNow({ state: "sin-mano", progress: 0 });
    setGestures((on) => !on);
  }

  function testInSimulator() {
    setPreferredRobot(robot.id);
    window.location.hash = "#mundo";
  }

  const ready = holo && stage === "listo";
  const selectedInfo: PartInfo | null = selected && info ? (info.components[selected] ?? null) : null;

  return (
    <div className="nocturno hangar">
      <AccountBar user={user} current="hangar" />
      <div className="hangar-cuerpo">
        <nav className="hangar-robots" aria-label="Robots del hangar">
          <div className="hangar-intro">
            <span className="nc-eyebrow">Hangar</span>
            <p>Cada robot, pieza a pieza: qué lleva, en qué misiones voló y cómo le fue en tus pruebas.</p>
          </div>
          {gestures && (
            <div className="hangar-gestos" role="group" aria-label="Mover el holograma con la mano">
              <GestureCamera onHands={onHands}>
                <p className={`gestos-estado${gestureNow.state === "sin-mano" || gestureNow.state === "espera" ? " alerta" : ""}`} role="status">
                  <b aria-hidden="true">{GESTURE_TEXT[gestureNow.state].icon}</b>
                  {GESTURE_TEXT[gestureNow.state].text}
                </p>
                {gestureNow.state === "senalar" && (
                  <div className="gestos-volante" aria-hidden="true">
                    <span style={{ left: `${gestureNow.progress * 100}%` }} />
                  </div>
                )}
              </GestureCamera>
              <ul className="gestos-leyenda">
                <li className={gestureNow.state === "girar" ? "activo" : undefined}>
                  <span aria-hidden="true">✋</span>
                  <span>Una mano abierta: muévela para girarlo</span>
                </li>
                <li className={gestureNow.state === "desarmar" ? "activo" : undefined}>
                  <span aria-hidden="true">🤲</span>
                  <span>Dos manos: sepáralas para desarmarlo y júntalas para armarlo</span>
                </li>
                <li className={gestureNow.state === "pausa" ? "activo" : undefined}>
                  <span aria-hidden="true">✊</span>
                  <span>Puño: lo sueltas</span>
                </li>
                <li className={gestureNow.state === "senalar" ? "activo" : undefined}>
                  <span aria-hidden="true">☝️</span>
                  <span>Señala un momento: siguiente componente</span>
                </li>
              </ul>
            </div>
          )}

          {ROBOT_GROUPS.map((group) => (
            <section key={group.id} aria-label={group.id}>
              <h2>{group.id}</h2>
              {ROBOTS.filter((entry) => entry.group === group.id).map((entry) => (
                <button key={entry.id} type="button" aria-current={entry.id === robotId ? "true" : undefined} onClick={() => chooseRobot(entry.id)}>
                  <strong>{entry.name}</strong>
                  <span>{entry.type}</span>
                  {!isHoloRobot(entry.id) && <small>Sin modelo 3D</small>}
                </button>
              ))}
            </section>
          ))}
        </nav>

        <section className={`hangar-escenario${explode > 0.12 || selected ? " despejado" : ""}`} aria-label={`Holograma de ${robot.name}`}>
          <div className="hangar-lienzo" ref={containerRef} />
          <div className="hangar-etiquetas" aria-hidden="true">
            {ready &&
              order.map(
                (part, index) =>
                  pieces.includes(part) &&
                  info?.components[part] && (
                    <button
                      key={part}
                      type="button"
                      tabIndex={-1}
                      className={selected === part ? "elegida" : undefined}
                      ref={(element) => {
                        if (element) labelsRef.current.set(part, element);
                        else labelsRef.current.delete(part);
                      }}
                      onClick={() => pick(selected === part ? null : part)}
                    >
                      <b>{index + 1}</b>
                      <span>{info.components[part].name}</span>
                    </button>
                  ),
              )}
          </div>

          <header className="hangar-titulo">
            <span className="nc-eyebrow">
              {robot.group} · {robot.type}
            </span>
            <h1>{robot.name}</h1>
            <p>
              {robot.status} · {robot.destination}
            </p>
          </header>
          <dl className="hangar-ficha">
            <div>
              <dt>Masa</dt>
              <dd>{robot.mass}</dd>
            </div>
            <div>
              <dt>Tamaño</dt>
              <dd>{robot.size}</dd>
            </div>
            <div>
              <dt>Velocidad</dt>
              <dd>{robot.speed}</dd>
            </div>
            <div>
              <dt>Energía</dt>
              <dd>{robot.power}</dd>
            </div>
            <div>
              <dt>Movilidad</dt>
              <dd>{robot.locomotion}</dd>
            </div>
          </dl>

          {holo && stage === "cargando" && (
            <p className="hangar-aviso" role="status">
              Proyectando el holograma…
            </p>
          )}
          {holo && stage === "error" && (
            <p className="hangar-aviso error" role="alert">
              No se pudo cargar el modelo 3D. Revisa la conexión y vuelve a elegir el robot.
            </p>
          )}
          {!holo && (
            <div className="hangar-sin-modelo">
              <strong>Sin holograma</strong>
              <p>No hay un modelo 3D publicado de este robot ni medidas para dibujarlo, así que aquí no se inventa su forma.</p>
              <p>Su ficha y su historial sí están: míralos a la derecha.</p>
            </div>
          )}

          {holo && (
            <div className="hangar-abajo">
            <div className="hangar-mandos">
              <label className="hangar-desarmar">
                <span>Desarmar</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round(explode * 100)}
                  disabled={!ready || pieces.length < 2}
                  aria-valuetext={`${Math.round(explode * 100)} %`}
                  onChange={(event) => setExplode(Number(event.target.value) / 100)}
                />
              </label>
              <div className="hangar-grupo" role="group" aria-label="Aspecto del robot">
                <button type="button" aria-pressed={style === "holograma"} onClick={() => setStyle("holograma")}>
                  Holograma
                </button>
                <button type="button" aria-pressed={style === "real"} onClick={() => setStyle("real")}>
                  Real
                </button>
              </div>
              <button type="button" className="hangar-boton" aria-pressed={spin} onClick={() => setSpin((on) => !on)}>
                Girar solo
              </button>
              <button type="button" className="hangar-boton" onClick={() => sceneRef.current?.resetView()}>
                Centrar
              </button>
              <button
                type="button"
                className="hangar-boton"
                aria-pressed={gestures}
                title="Mueve el holograma con las manos ante la cámara. La imagen no sale de tu equipo."
                onClick={toggleGestures}
              >
                <span aria-hidden="true">✋</span> Con la mano
              </button>
            </div>
            <p className="hangar-credito">
              {robot.model?.kind === "nasa" ? `${robot.model.credit}.` : robot.model?.note} Arrastra para girar, usa la rueda para acercar y haz clic en una
              pieza.
            </p>
            </div>
          )}
        </section>

        <aside className="hangar-panel" aria-label={`Componentes e historial de ${robot.name}`}>
          <div className="hangar-pestanas" role="tablist" aria-label="Qué ver del robot">
            <button type="button" role="tab" id="hangar-pestana-componentes" aria-selected={tab === "componentes"} aria-controls="hangar-contenido" disabled={!holo} onClick={() => setTab("componentes")}>
              Componentes
            </button>
            <button type="button" role="tab" id="hangar-pestana-historial" aria-selected={tab === "historial"} aria-controls="hangar-contenido" onClick={() => setTab("historial")}>
              Historial
            </button>
          </div>

          <div className="hangar-contenido" id="hangar-contenido" role="tabpanel" aria-labelledby={`hangar-pestana-${tab}`}>
            {tab === "componentes" && info && (
              <>
                <p className="nc-nota">
                  Elige una pieza, aquí o en el holograma. «Herencia de vuelo» son las otras misiones en las que voló, o volará, esa misma pieza
                  o su diseño.
                </p>
                <ol className="hangar-piezas">
                  {order.map((part, index) => {
                    const item = info.components[part];
                    if (!item) return null;
                    const open = selected === part;
                    return (
                      <li
                        key={part}
                        className={open ? "abierta" : undefined}
                        onPointerEnter={() => sceneRef.current?.setHovered(part)}
                        onPointerLeave={() => sceneRef.current?.setHovered(null)}
                      >
                        <button type="button" aria-expanded={open} onClick={() => pick(open ? null : part)}>
                          <b>{index + 1}</b>
                          <span>{item.name}</span>
                          {item.heritage.length > 0 && (
                            <small title="Otras misiones con esta misma pieza o diseño">
                              {`${item.heritage.length} ${item.heritage.length === 1 ? "misión" : "misiones"}`}
                            </small>
                          )}
                        </button>
                        {open && <PartCard item={item} separate={!ready || pieces.includes(part)} usage={summary && USAGE[part] ? USAGE[part](summary) : null} />}
                      </li>
                    );
                  })}
                </ol>
              </>
            )}

            {tab === "historial" && (
              <>
                <section className="hangar-seccion">
                  <h3>Misiones reales</h3>
                  {info?.missions.length ? (
                    info.missions.map((mission) => (
                      <article key={mission.name} className="hangar-mision">
                        <header>
                          <strong>{mission.name}</strong>
                          <span>{mission.agency}</span>
                        </header>
                        {(mission.start || mission.where) && (
                          <p className="hangar-periodo">{[mission.start || mission.end ? periodText(mission) : "", mission.where].filter(Boolean).join(" · ")}</p>
                        )}
                        <p>{mission.summary}</p>
                        <ol className="hangar-hitos">
                          {mission.milestones.map((milestone) => (
                            <li key={milestone.date + milestone.text}>
                              <time dateTime={milestone.date}>{dateText(milestone.date)}</time>
                              <p>
                                {milestone.text}{" "}
                                <a href={milestone.source.url} target="_blank" rel="noreferrer" title={milestone.source.title}>
                                  Fuente ↗
                                </a>
                              </p>
                            </li>
                          ))}
                        </ol>
                      </article>
                    ))
                  ) : (
                    <p className="nc-nota">Sin historial comprobado para este robot.</p>
                  )}
                </section>

                <section className="hangar-seccion">
                  <h3>Tus pruebas en PROMETHEUS</h3>
                  {!robot.vehicle ? (
                    <p className="nc-nota">{robot.blocked}</p>
                  ) : summary ? (
                    <>
                      <ul className="hangar-resumen">
                        <li>
                          <b>{summary.runs}</b>
                          <span>{summary.runs === 1 ? "prueba" : "pruebas"}</span>
                        </li>
                        <li>
                          <b>{summary.places}</b>
                          <span>{summary.places === 1 ? "lugar" : "lugares"}</span>
                        </li>
                        <li>
                          <b>{decimal(summary.distanceM, 1)} m</b>
                          <span>recorridos</span>
                        </li>
                        <li>
                          <b>{summary.stuckRuns}</b>
                          <span>{summary.stuckRuns === 1 ? "atasco" : "atascos"}</span>
                        </li>
                      </ul>
                      <ol className="hangar-pruebas">
                        {runs.slice(0, 8).map((entry) => (
                          <li key={entry.id} className={entry.outcome}>
                            <strong>{entry.siteName}</strong>
                            <span>{outcomeText(entry)}</span>
                            <p>
                              {[
                                dateText(entry.at.slice(0, 10)),
                                `${decimal(entry.distanceM, 1)} m`,
                                `patinaje máx. ${entry.maxSlipPercent} %`,
                                `pendiente máx. ${decimal(entry.maxSlopeDeg, 1)}°`,
                                entry.gestures ? "con la mano" : "",
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                            </p>
                          </li>
                        ))}
                      </ol>
                      {runs.length > 8 && <p className="nc-nota">{`Se muestran las 8 más recientes de ${runs.length}.`}</p>}
                    </>
                  ) : (
                    <p className="nc-nota">Todavía no has probado este robot en el simulador.</p>
                  )}
                  {robot.vehicle && (
                    <>
                      <button type="button" className="nc-btn primario compacto" onClick={testInSimulator}>
                        Probar este robot en el simulador
                      </button>
                      <p className="nc-nota">
                        Elige un lugar en el Mundo y abre «Prueba del robot»: el simulador arrancará con este robot. Tus pruebas se guardan en este
                        navegador y son resultados del simulador, no pruebas de campo.
                      </p>
                    </>
                  )}
                </section>
              </>
            )}
          </div>
          <p className="hangar-pie">
            Datos de NASA, JPL, NSSDC, ESA y el Smithsonian, comprobados el {dateText(HANGAR_CHECKED)}.{" "}
            <a href={robot.source.url} target="_blank" rel="noreferrer">
              {robot.source.label} ↗
            </a>
          </p>
        </aside>
      </div>
      {selectedInfo && <span className="hangar-lector" role="status">{`Componente elegido: ${selectedInfo.name}`}</span>}
    </div>
  );
}

/** Lo que se sabe de un componente: qué es, sus datos publicados y en qué otras misiones voló. */
function PartCard({ item, separate, usage }: { item: PartInfo; separate: boolean; usage: string | null }) {
  return (
    <div className="hangar-pieza">
      <p>{item.what}</p>
      {!separate && <p className="nc-nota">En este modelo 3D esta pieza no viene separada del resto: no se resalta sola.</p>}
      <dl>
        {item.facts.map((fact) => (
          <div key={fact.label}>
            <dt>{fact.label}</dt>
            <dd>
              {fact.value}{" "}
              <a href={fact.source.url} target="_blank" rel="noreferrer" title={fact.source.title} aria-label={`Fuente: ${fact.source.title}`}>
                ↗
              </a>
            </dd>
          </div>
        ))}
      </dl>
      <h4>Herencia de vuelo</h4>
      {item.heritage.length > 0 ? (
        <ol className="hangar-herencia">
          {item.heritage.map((entry) => (
            <li key={entry.mission + entry.year}>
              <time>{entry.year}</time>
              <div>
                <strong>{entry.mission}</strong>
                {isPlanned(entry) && <em>previsto</em>}
                <p>
                  {entry.note}{" "}
                  <a href={entry.source.url} target="_blank" rel="noreferrer" title={entry.source.title}>
                    Fuente ↗
                  </a>
                </p>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="nc-nota">No encontramos una fuente que confirme esta pieza en otra misión.</p>
      )}
      {usage && <p className="hangar-uso">{usage}</p>}
    </div>
  );
}
