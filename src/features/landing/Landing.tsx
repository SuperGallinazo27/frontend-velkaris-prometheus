import { useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import { Icon } from "../../components/Icon";
import { candidates, regions } from "../../data/demo";
import type { Terrain } from "../../types/analysis";
import { rankCandidates } from "../ranking/ranking";
import { chapterProgress, journeyFraction } from "./journey";
import type { SceneHandle } from "./scene";
import "./landing.css";

/** Capítulos de la portada, en el mismo orden que los encuadres de la escena (SHOTS). */
const chapters = [
  { id: "inicio", name: "Inicio" },
  { id: "luna", name: "Luna" },
  { id: "marte", name: "Marte" },
  { id: "metodo", name: "Método" },
  { id: "candidatos", name: "Candidatos" },
  { id: "explorar", name: "Explorar" },
];

/** Paradas del indicador inferior: la Tierra es el punto de partida y de regreso. */
const stops = [
  { name: "Tierra", at: 0 },
  { name: "Luna", at: 0.25 },
  { name: "Marte", at: 0.5 },
  { name: "Tierra", at: 1 },
];

const modules = [
  { hash: "#explorador", icon: "map", name: "Explorador", detail: "Mapa esquemático y ficha de cada candidato." },
  { hash: "#ranking", icon: "ranking", name: "Ranking", detail: "Comparación completa y exportación CSV." },
  { hash: "#riesgos", icon: "risks", name: "Riesgos", detail: "Matriz ilustrativa de incertidumbres." },
  { hash: "#economia", icon: "economy", name: "Economía", detail: "Presupuesto de una campaña terrestre." },
];

const moonRegions = regions.filter((r) => r.world === "Luna");
const marsRegions = regions.filter((r) => r.world === "Marte");

type Mode = "cargando" | "3d" | "estatica";

const prefersReducedMotion = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** `?estatico` en la dirección muestra la portada sin escena 3D, para probar esa versión. */
const forceStatic = () => new URLSearchParams(window.location.search).has("estatico");

/** Verdadero desde que el elemento entra en pantalla por primera vez. */
function useSeen(ref: RefObject<HTMLElement | null>): boolean {
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element || seen) return;
    const observer = new IntersectionObserver(
      (entries) => entries.some((e) => e.isIntersecting) && setSeen(true),
      { threshold: 0.3 },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, seen]);
  return seen;
}

/** Número que cuenta hasta su valor cuando este cambia. Sin animación muestra el valor directamente. */
function Cifra({ value, animate }: { value: number; animate: boolean }) {
  const [shown, setShown] = useState(0);
  const current = useRef(0);
  useEffect(() => {
    if (!animate) return;
    const from = current.current;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / 750);
      const next = Math.round(from + (value - from) * (1 - Math.pow(1 - t, 3)));
      current.current = next;
      setShown(next);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, animate]);
  return <>{(animate ? shown : value).toLocaleString("es")}</>;
}

/** Capítulo de un mundo de referencia: selector de escenario y sus tres descriptores. */
function Referencia({
  id,
  side,
  eyebrow,
  title,
  intro,
  options,
  selected,
  calm,
  onSelect,
}: {
  id: string;
  side: "izq" | "der";
  eyebrow: string;
  title: string;
  intro: string;
  options: Terrain[];
  selected: Terrain;
  calm: boolean;
  onSelect: (id: string) => void;
}) {
  const figuresRef = useRef<HTMLDListElement>(null);
  // Las cifras cuentan desde cero al entrar en pantalla; sin movimiento muestran su valor desde el principio.
  const seen = useSeen(figuresRef) || calm;
  const figure = (value: number) => <Cifra key={String(calm)} value={seen ? value : 0} animate={!calm} />;
  return (
    <section className={`lp-cap ${side}`} id={id} aria-labelledby={`lp-t-${id}`}>
      <div className="lp-ancho">
        <div className="lp-panel">
          <span className="lp-eyebrow">{eyebrow}</span>
          <h2 id={`lp-t-${id}`}>{title}</h2>
          <p>{intro}</p>
          <div className="lp-regiones" role="group" aria-label={`Escenario de ${selected.world}`}>
            {options.map((r) => (
              <button key={r.id} type="button" aria-pressed={r.id === selected.id} onClick={() => onSelect(r.id)}>
                {r.name}
              </button>
            ))}
          </div>
          <dl className="lp-cifras" ref={figuresRef}>
            <div>
              <dt>Relieve</dt>
              <dd>
                {figure(selected.relief)} <small>m</small>
              </dd>
            </div>
            <div>
              <dt>Pendiente</dt>
              <dd>{figure(selected.slope)}°</dd>
            </div>
            <div>
              <dt>Rugosidad</dt>
              <dd>
                {figure(selected.roughness)} <small>m</small>
              </dd>
            </div>
          </dl>
          <p className="lp-nota">{selected.context} · valores sintéticos, no son mediciones.</p>
        </div>
      </div>
    </section>
  );
}

export function Landing({
  regionId,
  onRegionChange,
}: {
  /** Región de referencia vigente: la que se compara con los candidatos terrestres. */
  regionId: string;
  onRegionChange: (id: string) => void;
}) {
  const [mode, setMode] = useState<Mode>(() => (forceStatic() ? "estatica" : "cargando"));
  const [calm, setCalm] = useState(prefersReducedMotion);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<SceneHandle | null>(null);
  const progressRef = useRef(0);

  const region = regions.find((r) => r.id === regionId) ?? moonRegions[0];
  // Cada mundo recuerda su escenario; el último que se toca pasa a ser la referencia.
  const [moonId, setMoonId] = useState(region.world === "Luna" ? region.id : moonRegions[0].id);
  const [marsId, setMarsId] = useState(region.world === "Marte" ? region.id : marsRegions[0].id);
  const moon = moonRegions.find((r) => r.id === moonId) ?? moonRegions[0];
  const mars = marsRegions.find((r) => r.id === marsId) ?? marsRegions[0];
  const ranked = useMemo(() => rankCandidates(region, candidates), [region]);

  const selectMoon = (id: string) => {
    setMoonId(id);
    onRegionChange(id);
  };
  const selectMars = (id: string) => {
    setMarsId(id);
    onRegionChange(id);
  };

  // Los efectos que crean la escena leen el estado más reciente desde aquí.
  const latest = useRef({ calm, moonId: moon.id, marsId: mars.id, ranked });
  useEffect(() => {
    latest.current = { calm, moonId: moon.id, marsId: mars.id, ranked };
  });

  /* Fondo oscuro del documento y posición inicial mientras la portada está montada. */
  useEffect(() => {
    document.documentElement.classList.add("portada-activa");
    const anchor = document.getElementById(window.location.hash.slice(1));
    if (anchor) anchor.scrollIntoView();
    else window.scrollTo(0, 0);
    return () => document.documentElement.classList.remove("portada-activa");
  }, []);

  /* Escena 3D: se carga después de mostrar el texto. Si falla, queda el fondo estático. */
  useEffect(() => {
    if (forceStatic()) return;
    let cancelled = false;
    let handle: SceneHandle | null = null;
    import("./scene")
      .then(({ createScene }) => {
        if (cancelled || !hostRef.current || !labelsRef.current) return;
        handle = createScene({
          host: hostRef.current,
          labels: labelsRef.current,
          regions,
          candidates,
          calm: latest.current.calm,
          onContextLost: () => setMode("estatica"),
        });
        handle.setSelection(latest.current.moonId, latest.current.marsId, latest.current.ranked);
        handle.setProgress(progressRef.current);
        handleRef.current = handle;
        setMode("3d");
      })
      .catch(() => {
        if (!cancelled) setMode("estatica");
      });
    return () => {
      cancelled = true;
      handleRef.current = null;
      handle?.dispose();
    };
  }, []);

  /* Scroll → avance por capítulos: mueve la cámara, el indicador inferior y el punto activo. */
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const sections = chapters
      .map((c) => document.getElementById(c.id))
      .filter((el): el is HTMLElement => el !== null);
    let centers: number[] = [];
    const measure = () => {
      centers = sections.map((el) => {
        const box = el.getBoundingClientRect();
        return box.top + window.scrollY + box.height / 2;
      });
    };
    const onScroll = () => {
      const p = chapterProgress(centers, window.scrollY + window.innerHeight / 2);
      progressRef.current = p;
      handleRef.current?.setProgress(p);
      root.style.setProperty("--viaje", journeyFraction(p).toFixed(4));
      setActive(Math.round(p));
    };
    const onResize = () => {
      measure();
      onScroll();
    };
    onResize();
    const resizeObserver = new ResizeObserver(onResize);
    resizeObserver.observe(root);
    window.addEventListener("scroll", onScroll, { passive: true });

    // Cada panel aparece la primera vez que su capítulo entra en pantalla.
    const reveal = new IntersectionObserver(
      (entries) =>
        entries.forEach((entry) => {
          if (entry.isIntersecting) entry.target.classList.add("vista");
        }),
      { threshold: 0.2 },
    );
    sections.forEach((el) => reveal.observe(el));
    return () => {
      resizeObserver.disconnect();
      reveal.disconnect();
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  useEffect(() => {
    handleRef.current?.setSelection(moon.id, mars.id, ranked);
  }, [moon, mars, ranked]);

  useEffect(() => {
    handleRef.current?.setCalm(calm);
  }, [calm]);

  const rootClass = [
    "landing",
    mode === "3d" ? "con-escena" : "",
    mode === "estatica" ? "estatica" : "",
    calm ? "en-calma" : "con-movimiento",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={rootClass} data-cap={active} ref={rootRef}>
      <a className="skip-link" href="#luna">
        Saltar al contenido
      </a>

      <div className="lp-fondo" aria-hidden="true">
        <span className="lp-disco tierra" />
        <span className="lp-disco luna" />
        <span className="lp-disco marte" />
      </div>
      <div className="lp-escena" ref={hostRef} />
      <div className="lp-etiquetas" ref={labelsRef} aria-hidden="true" />

      <header className="lp-header">
        <a className="brand" href="#inicio" aria-label="PROMETHEUS by VELKARIS, inicio">
          <span className="brand-symbol">
            P<span>◦</span>
          </span>
          <div>
            PROMETHEUS<small>BY VELKARIS</small>
          </div>
        </a>
        <nav className="lp-nav" aria-label="Secciones de la portada">
          <a href="#luna">Luna</a>
          <a href="#marte">Marte</a>
          <a href="#metodo">Método</a>
          <a href="#candidatos">Candidatos</a>
        </nav>
        <a className="lp-btn primario compacto" href="#explorador">
          Abrir explorador <Icon name="arrow" size={16} />
        </a>
      </header>

      <nav className="lp-puntos" aria-label="Capítulos">
        {chapters.map((chapter, i) => (
          <a key={chapter.id} href={`#${chapter.id}`} aria-current={active === i ? "step" : undefined}>
            <span>{chapter.name}</span>
            <i />
          </a>
        ))}
      </nav>

      <main className="lp-contenido">
        <section className="lp-cap izq vista" id="inicio" aria-labelledby="lp-t-inicio">
          <div className="lp-ancho">
            <div className="lp-panel ancho">
              <span className="lp-eyebrow">Explorador de análogos planetarios</span>
              <h1 id="lp-t-inicio">
                De otros mundos. <span>A nuestro planeta.</span>
              </h1>
              <p className="lp-lead">
                PROMETHEUS busca en la Tierra paisajes parecidos a los de otros mundos: primero la Luna, después
                Marte. Un punto de partida para explorar similitudes y formular mejores preguntas.
              </p>
              <div className="lp-acciones">
                <a className="lp-btn primario" href="#explorador">
                  Abrir el explorador <Icon name="arrow" size={18} />
                </a>
                <a className="lp-btn secundario" href="#metodo">
                  Cómo funciona
                </a>
              </div>
              <p className="lp-demo">
                <b>DEMO</b>
                <span>
                  Datos sintéticos, sin validación científica. Los mundos de esta página se dibujan por código: no
                  son imágenes ni datos de NASA.
                </span>
              </p>
              <a className="lp-desliza" href="#luna">
                Desliza para iniciar el viaje <span aria-hidden="true">↓</span>
              </a>
            </div>
          </div>
        </section>

        <Referencia
          id="luna"
          side="der"
          eyebrow="01 / Primer alcance"
          title="La Luna, el primer paso."
          intro="Elige un escenario lunar. Sus tres descriptores de relieve son la referencia contra la que se compara cada paisaje terrestre."
          options={moonRegions}
          selected={moon}
          calm={calm}
          onSelect={selectMoon}
        />

        <Referencia
          id="marte"
          side="izq"
          eyebrow="02 / Siguiente alcance"
          title="Proximamente.... Marte."
          intro="El mismo método, un mundo más lejos. Elige un escenario marciano para usarlo como referencia."
          options={marsRegions}
          selected={mars}
          calm={calm}
          onSelect={selectMars}
        />

        <section className="lp-cap izq" id="metodo" aria-labelledby="lp-t-metodo">
          <div className="lp-ancho">
            <div className="lp-panel">
              <span className="lp-eyebrow">03 / Método</span>
              <h2 id="lp-t-metodo">Una distancia que se puede explicar.</h2>
              <p>
                Para cada candidato terrestre se promedian tres diferencias con la referencia lunar o marciana. Menor
                distancia, mayor proximidad en esos descriptores.
              </p>
              <ul className="lp-formula">
                <li>
                  <span>Relieve</span>
                  <code>diferencia / 1000 m</code>
                </li>
                <li>
                  <span>Pendiente</span>
                  <code>diferencia / 15°</code>
                </li>
                <li>
                  <span>Rugosidad</span>
                  <code>diferencia / 100 m</code>
                </li>
              </ul>
              <p className="lp-nota">
                Pesos iguales y escalas ilustrativas. No es un porcentaje de similitud ni una probabilidad, y no
                compara clima, geología ni habitabilidad.
              </p>
            </div>
          </div>
        </section>

        <section className="lp-cap der" id="candidatos" aria-labelledby="lp-t-candidatos">
          <div className="lp-ancho">
            <div className="lp-panel">
              <span className="lp-eyebrow">04 / Candidatos terrestres</span>
              <h2 id="lp-t-candidatos">¿Qué paisaje se le parece más?</h2>
              <p>
                La Tierra es el eje: aquí se ordenan los tres candidatos de ejemplo frente a{" "}
                <strong>{region.name}</strong>.
              </p>
              <div className="lp-regiones" role="group" aria-label="Mundo de referencia">
                {[moon, mars].map((r) => (
                  <button key={r.id} type="button" aria-pressed={r.id === region.id} onClick={() => onRegionChange(r.id)}>
                    {r.world} · {r.name}
                  </button>
                ))}
              </div>
              <ol className="lp-ranking">
                {ranked.map((row) => (
                  <li key={row.site.id} className={row.rank === 1 ? "primero" : undefined}>
                    <span className="lp-pos">{String(row.rank).padStart(2, "0")}</span>
                    <div>
                      <strong>{row.site.name}</strong>
                      <small>{row.site.context}</small>
                    </div>
                    <span className="lp-dist">
                      {row.distance.toFixed(3)}
                      <small>{row.rank === 1 ? "más próximo" : "distancia"}</small>
                    </span>
                  </li>
                ))}
              </ol>
              <a className="lp-enlace" href="#ranking">
                Ver el ranking completo <Icon name="arrow" size={16} />
              </a>
            </div>
          </div>
        </section>

        <section className="lp-cap centro" id="explorar" aria-labelledby="lp-t-explorar">
          <div className="lp-ancho">
            <div className="lp-panel">
              <span className="lp-eyebrow">05 / Explora</span>
              <h2 id="lp-t-explorar">Sigue el viaje en el explorador.</h2>
              <p>Cuatro módulos para mirar los mismos datos de ejemplo desde distintos ángulos.</p>
              <div className="lp-modulos">
                {modules.map((m) => (
                  <a key={m.hash} href={m.hash}>
                    <Icon name={m.icon} size={22} />
                    <strong>{m.name}</strong>
                    <span>{m.detail}</span>
                  </a>
                ))}
              </div>
            </div>
          </div>
          <footer className="lp-pie">
            <span>
              PROMETHEUS <span className="footer-dot">/</span> Una iniciativa VELKARIS
            </span>
            <span>Datos demo · sin conexión a NASA · sin API activa</span>
            <a href="https://github.com/SuperGallinazo27/velkaris-prometheus" target="_blank" rel="noreferrer">
              Proyecto Python ↗
            </a>
          </footer>
        </section>
      </main>

      <div className="lp-barra">
        <div className="lp-hud" aria-hidden="true">
          <div className="lp-via">
            <i className="lp-recorrido" />
            {stops.map((stop, i) => (
              <span key={i} className="lp-parada" style={{ left: `${stop.at * 100}%` }}>
                {stop.name}
              </span>
            ))}
            <i className="lp-sonda" />
          </div>
        </div>
        {mode === "3d" && (
          <button className="lp-pausa" type="button" aria-pressed={calm} onClick={() => setCalm((value) => !value)}>
            <span aria-hidden="true">{calm ? "▶" : "❙❙"}</span>
            <span className="lp-pausa-texto">{calm ? "Reanudar movimiento" : "Pausar movimiento"}</span>
          </button>
        )}
      </div>
    </div>
  );
}
