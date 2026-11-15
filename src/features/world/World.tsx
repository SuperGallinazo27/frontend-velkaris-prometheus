import { Suspense, lazy, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AccountBar } from "../../components/AccountBar";
import { Icon } from "../../components/Icon";
import { regions } from "../../data/demo";
import type { User } from "../../services/auth";
import { PlaceBadge } from "../turnos/PlaceBadge";
import { usePlaceStatuses } from "../turnos/usePlaceStatuses";
import { decimal } from "./format";
import type { GlobeHandle, GlobeNode } from "./globe";
import { BANDS, LEVELS, LEVEL_PLURALS, childrenOf, matchPercent, matchZones, nodeOf, nodesAt, trimPath } from "./hierarchy";
import type { Band, Node } from "./hierarchy";
import { DEFAULT_REGION, LUNAR_ZONES, lunarRegions, regionsOf, terrainSources, unmeasuredZones, zoneInfo, zonesFor } from "./lunar";
import { LunarMap } from "./LunarMap";
import type { PlaceMapHandle } from "./placeEngine";
import { distanceFor } from "./view";
import { ZoneCard } from "./ZoneCard";
import { zones } from "./zones";
import "./world.css";

type ReferenceWorld = "Luna" | "Marte";
type Mode = "cargando" | "3d" | "sin-3d";

const WORLDS: ReferenceWorld[] = ["Luna", "Marte"];

/** Marte sigue con escenarios sintéticos de demostración; la Luna usa terreno real. */
const marsScenarios = regions.filter((r) => r.world === "Marte");

/** El mapa del lugar trae su propia librería (MapLibre): se descarga al abrir el primer lugar. */
const PlaceMap = lazy(() => import("./PlaceMap"));

/** Lado del área analizada alrededor de cada lugar: 6 ventanas de 3 km. */
const PLACE_HALF_M = 9000;
/** Anchos del panel y de la tarjeta lunar; coinciden con world.css. */
const PANEL_SPACE = 412;
const WIDE = 900;
const lunarCardWidth = (width: number) => (width > 1180 ? 348 : 290);

const prefersReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const isWide = () => window.matchMedia(`(min-width: ${WIDE}px)`).matches;

function onResize(notify: () => void) {
  window.addEventListener("resize", notify);
  return () => window.removeEventListener("resize", notify);
}

/** Tamaño de la ventana, para repartir el espacio entre los paneles y los mapas. */
function useViewport() {
  const width = useSyncExternalStore(onResize, () => window.innerWidth);
  const height = useSyncExternalStore(onResize, () => window.innerHeight);
  return { width, height };
}

const plural = (count: number) => `${count} ${count === 1 ? "localidad" : "localidades"}`;

/** Lo que el globo necesita saber de cada nodo. */
function toGlobeNode(node: Node): GlobeNode {
  const isZone = node.level === 3;
  return {
    path: node.path,
    name: node.name,
    detail: isZone ? `${matchPercent(node.best.distance)} %` : String(node.count),
    label: isZone
      ? `${node.name}, ${matchPercent(node.best.distance)} % de coincidencia. Ver detalle`
      : `${node.name}, ${plural(node.count)}. Acercar para desglosar`,
    latitude: node.latitude,
    longitude: node.longitude,
  };
}

export default function World({ user }: { user: User }) {
  const [world, setWorld] = useState<ReferenceWorld>("Luna");
  const [regionId, setRegionId] = useState(DEFAULT_REGION);
  const [band, setBand] = useState<Band>("alta");
  const [chosen, setChosen] = useState<string[]>([]);
  const [level, setLevel] = useState(0);
  const [mode, setMode] = useState<Mode>("cargando");
  const [mapError, setMapError] = useState(false);
  const [lunarMapOpen, setLunarMapOpen] = useState(isWide);
  const hostRef = useRef<HTMLDivElement>(null);
  const marksRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<GlobeHandle | null>(null);
  const placeRef = useRef<PlaceMapHandle | null>(null);
  const viewport = useViewport();
  // Si un lugar está en un área protegida, cerrado u ocupado hoy, la lista lo avisa.
  const placeStatuses = usePlaceStatuses();

  // Con la Luna, cada lugar se compara con la región elegida y con terreno real en ambos lados.
  const region = world === "Luna" ? (lunarRegions.find((r) => r.id === regionId) ?? lunarRegions[0]) : null;
  const matches = useMemo(
    () => (region ? matchZones(zonesFor(region), [region]) : matchZones(zones, marsScenarios)),
    [region],
  );
  const visible = useMemo(() => matches.filter((m) => m.band === band), [matches, band]);
  const globeLevels = useMemo(() => LEVELS.map((_, i) => nodesAt(visible, i).map(toGlobeNode)), [visible]);
  // Si el filtro deja fuera el lugar elegido, la ruta se queda en su ancestro más cercano que siga visible.
  const focus = useMemo(() => trimPath(visible, chosen), [visible, chosen]);
  const focusNode = nodeOf(visible, focus);
  // Dentro de cada nivel, lo más parecido va primero.
  const children = childrenOf(visible, focus).sort((a, b) => a.best.distance - b.best.distance);
  const target = region ? region.name : "Marte";
  const bandInfo = BANDS.find((b) => b.id === band)!;
  const closest = matches.length ? matches.reduce((a, b) => (b.distance < a.distance ? b : a)) : null;

  // El globo se crea una vez y recibe los datos más recientes desde aquí.
  const latest = useRef({ globeLevels, focus, pick });
  useEffect(() => {
    latest.current = { globeLevels, focus, pick };
  });

  useEffect(() => {
    let cancelled = false;
    let handle: GlobeHandle | null = null;
    import("./globe")
      .then(({ createGlobe }) => {
        if (cancelled || !hostRef.current || !marksRef.current) return;
        handle = createGlobe({
          host: hostRef.current,
          markers: marksRef.current,
          calm: prefersReducedMotion(),
          onPick: (path) => latest.current.pick(path),
          onLevel: setLevel,
          onMapError: () => setMapError(true),
          onContextLost: () => setMode("sin-3d"),
        });
        handle.setNodes(latest.current.globeLevels);
        handle.setFocus(latest.current.focus);
        handleRef.current = handle;
        setMode("3d");
      })
      .catch(() => {
        if (!cancelled) setMode("sin-3d");
      });
    return () => {
      cancelled = true;
      handleRef.current = null;
      handle?.dispose();
    };
  }, []);

  useEffect(() => {
    handleRef.current?.setNodes(globeLevels);
  }, [globeLevels]);

  useEffect(() => {
    handleRef.current?.setFocus(focus);
  }, [focus]);

  // Si cambiar de región o de parecido deja fuera el lugar que se estaba viendo, la cámara
  // retrocede hasta el nivel que sigue visible en vez de quedarse sobre un lugar sin marcador.
  useEffect(() => {
    if (focus.length >= chosen.length) return;
    const node = nodeOf(visible, focus);
    if (node) handleRef.current?.flyTo(node.latitude, node.longitude, distanceFor(focus.length));
    else handleRef.current?.home();
  }, [focus, chosen, visible]);

  // Con el mapa lunar abierto a la derecha, el globo y el mapa del lugar se corren para no quedar debajo.
  const wide = viewport.width >= WIDE;
  const lunarCardShown = Boolean(region) && lunarMapOpen;
  const rightSpace = wide && lunarCardShown ? lunarCardWidth(viewport.width) + 32 : 0;
  useEffect(() => {
    handleRef.current?.setRightInset(rightSpace);
  }, [rightSpace, mode]);

  // Al llegar a un lugar, el globo deja paso a su mapa de cerca.
  const place = focusNode?.level === 3 ? focusNode.best.zone : null;
  const sceneHeight = viewport.height - 64;
  const placeTop = wide ? 16 : region ? 72 : 8;
  const zoomBy = (factor: number) => (place ? placeRef.current : handleRef.current)?.zoomBy(factor);

  /** Elige un nodo: la cámara vuela hasta él y se acerca lo justo para mostrar lo que contiene. */
  function pick(path: string[]) {
    setChosen(path);
    const node = nodeOf(visible, path);
    if (node) handleRef.current?.flyTo(node.latitude, node.longitude, distanceFor(path.length));
    else handleRef.current?.home();
  }

  return (
    <div className={`nocturno mundo mundo-${world.toLowerCase()}`}>
      <AccountBar user={user} current="mundo" />
      <div className="mundo-escena">
        <div
          className="mundo-lienzo"
          ref={hostRef}
          tabIndex={0}
          role="application"
          aria-label="Globo terrestre interactivo. Flechas para girar, más y menos para acercar o alejar, Inicio para ver el globo completo."
        />
        <div className="mundo-marcas" ref={marksRef} />

        {place && (
          <Suspense fallback={null}>
            <PlaceMap
              key={place.id}
              name={place.name}
              latitude={place.latitude}
              longitude={place.longitude}
              halfM={PLACE_HALF_M}
              left={wide ? PANEL_SPACE : 0}
              right={rightSpace}
              top={placeTop + 56}
              bottom={wide ? 64 : Math.round(sceneHeight * 0.47) + 64}
              calm={prefersReducedMotion()}
              compact={!wide}
              onBack={() => pick(focus.slice(0, 3))}
              handleRef={placeRef}
            />
          </Suspense>
        )}

        <aside className={`mundo-panel nc-tarjeta${place ? " con-lugar" : ""}`} aria-label="Localidades">
          <header>
            <span className="nc-eyebrow">Mundo interactivo</span>
            <h1>Lugares de la Tierra parecidos a {region ? "la Luna" : "Marte"}</h1>
            <div className="mundo-filtros">
              <label className="nc-campo">
                <span>
                  Mundo<i> de referencia</i>
                </span>
                <select id="mundo-referencia" value={world} onChange={(e) => setWorld(e.target.value as ReferenceWorld)}>
                  {WORLDS.map((w) => (
                    <option key={w} value={w}>
                      {w}
                    </option>
                  ))}
                </select>
              </label>
              <label className="nc-campo">
                <span>Similitud</span>
                <select id="mundo-parecido" value={band} onChange={(e) => setBand(e.target.value as Band)}>
                  {BANDS.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name} · {b.range}
                    </option>
                  ))}
                </select>
              </label>
              {region && (
                <label className="nc-campo mundo-region">
                  <span>
                    Región lunar<i> · {zoneInfo(region.zone).name.toLowerCase()}</i>
                  </span>
                  <select id="mundo-region" value={region.id} onChange={(e) => setRegionId(e.target.value)}>
                    {LUNAR_ZONES.map((zone) => (
                      <optgroup key={zone.id} label={zone.name}>
                        {regionsOf(zone.id).map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </label>
              )}
            </div>
            <p className="nc-nota" role="status">
              {region
                ? `${plural(visible.length)} con terreno ${bandInfo.terrain} al de ${target}, de ${matches.length} con datos.${unmeasuredZones.map((zone) => ` Sin datos: ${zone.name} (${zone.reason}).`).join("")}`
                : `${plural(visible.length)} de ejemplo con similitud ${bandInfo.name.toLowerCase()} con ${target}, de ${zones.length} en total.`}
            </p>
          </header>

          <nav className="mundo-ruta" aria-label="Ruta">
            <button type="button" onClick={() => pick([])} aria-current={focus.length === 0 ? "location" : undefined}>
              Tierra
            </button>
            {focus.map((name, i) => (
              <span key={name}>
                <span aria-hidden="true">›</span>
                <button
                  type="button"
                  onClick={() => pick(focus.slice(0, i + 1))}
                  aria-current={i === focus.length - 1 ? "location" : undefined}
                >
                  {name}
                </button>
              </span>
            ))}
          </nav>

          <div className="mundo-lista">
            {focusNode?.level === 3 ? (
              <ZoneCard
                key={focusNode.best.zone.id}
                match={focusNode.best}
                region={region}
                institution={user.profile?.agency ?? ""}
              />
            ) : children.length ? (
              <>
                <h2 className="mundo-nivel">
                  {LEVEL_PLURALS[focus.length]}
                  {focusNode && <span> de {focusNode.name}</span>}
                </h2>
                <ul>
                  {children.map((node) => (
                    <li key={node.name}>
                      <button type="button" onClick={() => pick(node.path)}>
                        <span>
                          <strong>{node.name}</strong>
                          <small>
                            {node.level < 3
                              ? `${plural(node.count)} · la más parecida: ${node.best.zone.name}`
                              : region
                                ? `Relieve ${decimal(node.best.zone.relief)} m · pendiente ${decimal(node.best.zone.slope, 1)}°`
                                : `Se parece a ${node.best.scenario.name}`}
                          </small>
                          {node.level === 3 && <PlaceBadge status={placeStatuses.get(node.best.zone.id)} />}
                        </span>
                        <span className="mono">{node.level === 3 ? `${matchPercent(node.best.distance)} %` : node.count}</span>
                        <Icon name="arrow" size={16} />
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <div className="mundo-vacio">
                <p>
                  Ninguna localidad de la lista tiene similitud {bandInfo.name.toLowerCase()} con {target}.
                  {closest &&
                    ` La más parecida es ${closest.zone.name}, con un ${matchPercent(closest.distance)} % de coincidencia.`}
                </p>
                {closest && (
                  <button type="button" className="nc-btn secundario compacto" onClick={() => setBand(closest.band)}>
                    Ver similitud {BANDS.find((b) => b.id === closest.band)!.name.toLowerCase()}
                  </button>
                )}
              </div>
            )}
          </div>

          <footer>
            {mode === "sin-3d" && (
              <p className="nc-aviso">Este navegador no puede mostrar el globo 3D. Puedes recorrer las localidades desde esta lista.</p>
            )}
            {mapError && (
              <p className="nc-aviso error" role="alert">
                No se pudo cargar el mapa de países. Recarga la página para intentarlo de nuevo.
              </p>
            )}
            {region ? (
              <p className="nc-aviso">
                <b>REAL</b>
                <span>
                  Elevación de la Luna (
                  <a href={zoneInfo(region.zone).source.url} target="_blank" rel="noreferrer">
                    {zoneInfo(region.zone).source.name}
                  </a>
                  ) y de la Tierra (
                  <a href={terrainSources.earth.url} target="_blank" rel="noreferrer">
                    Copernicus DEM
                  </a>
                  ) con el mismo cálculo. Solo compara la forma del terreno; no es una validación científica.
                </span>
              </p>
            ) : (
              <p className="nc-aviso">
                <b>DEMO</b>
                <span>
                  Datos estáticos de ejemplo. Los lugares existen; su parecido con Marte es sintético, no una
                  evaluación científica.
                </span>
              </p>
            )}
          </footer>
        </aside>

        {region && (
          <LunarMap
            selected={region}
            open={lunarMapOpen}
            onToggle={() => setLunarMapOpen((open) => !open)}
            onSelect={setRegionId}
          />
        )}

        {mode === "3d" && (
          <div className="mundo-controles">
            <span className="mundo-vista" role="status">
              Vista: {place ? "lugar" : LEVEL_PLURALS[level].toLowerCase()}
            </span>
            <div role="group" aria-label="Acercamiento">
              <button type="button" aria-label="Acercar" onClick={() => zoomBy(0.72)}>
                +
              </button>
              <button type="button" aria-label="Alejar" onClick={() => zoomBy(1.38)}>
                −
              </button>
              <button type="button" aria-label="Ver el globo completo" onClick={() => pick([])}>
                <Icon name="globe" size={18} />
              </button>
            </div>
          </div>
        )}
        {mode === "3d" && !place && (
          <p className="mundo-ayuda" aria-hidden="true">
            Arrastra para girar · rueda o pellizco para acercar · elige un marcador para desglosarlo
          </p>
        )}
      </div>
    </div>
  );
}
