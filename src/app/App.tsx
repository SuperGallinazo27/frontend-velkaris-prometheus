import { useMemo, useState } from "react";
import type { View } from "../types/analysis";
import { regions, candidates, demoRisks } from "../data/demo";
import { rankCandidates } from "../features/ranking/ranking";
import { AnalogMap } from "../features/explore/AnalogMap";
import { Economy } from "../features/economy/Economy";
import { Icon } from "../components/Icon";
const navigation: { id: View; name: string; icon: string }[] = [
  { id: "explore", name: "Explorador", icon: "map" },
  { id: "ranking", name: "Ranking de análogos", icon: "ranking" },
  { id: "risks", name: "Riesgos", icon: "risks" },
  { id: "economy", name: "Economía", icon: "economy" },
];
export default function App() {
  const [view, setView] = useState<View>("explore"),
    [regionId, setRegionId] = useState("gale"),
    [selectedId, setSelectedId] = useState("atacama"),
    [search, setSearch] = useState("");
  const region = regions.find((r) => r.id === regionId)!;
  const ranked = useMemo(() => rankCandidates(region, candidates), [region]);
  const selected = ranked.find((row) => row.site.id === selectedId)!;
  const filtered = ranked.filter((row) =>
    (row.site.name + " " + row.site.context)
      .toLocaleLowerCase()
      .includes(search.toLocaleLowerCase()),
  );
  function exportCsv() {
    const header = "modo,region,candidato,distancia_ilustrativa,posicion";
    const rows = ranked.map((row) =>
      [
        "DEMO_SINTETICA",
        region.name,
        row.site.name,
        row.distance.toFixed(6),
        row.rank,
      ].join(","),
    );
    const url = URL.createObjectURL(
      new Blob(["\uFEFF" + [header, ...rows].join("\n")], {
        type: "text/csv;charset=utf-8;",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `prometheus-demo-${region.id}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Saltar al contenido
      </a>
      <aside className="sidebar">
        <a className="brand" href="#" onClick={() => setView("explore")}>
          <span className="brand-symbol">
            P<span>◦</span>
          </span>
          <div>
            PROMETHEUS<small>BY VELKARIS</small>
          </div>
        </a>
        <div className="workspace">
          <span className="workspace-icon">
            <Icon name="globe" />
          </span>
          <div>
            Planetary workspace<small>Exploración de análogos</small>
          </div>
        </div>
        <span className="nav-label">ESPACIO DE ANÁLISIS</span>
        <nav aria-label="Navegación principal">
          {navigation.map((item) => (
            <button
              key={item.id}
              className={view === item.id ? "nav-item active" : "nav-item"}
              aria-current={view === item.id ? "page" : undefined}
              onClick={() => setView(item.id)}
            >
              <Icon name={item.icon} />
              <span>{item.name}</span>
              {view === item.id && <span className="nav-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="orbit-icon">
            <Icon name="spark" size={26} />
          </div>
          <h3>
            De otros mundos.
            <br />A nuestro planeta.
          </h3>
          <p>
            Un punto de partida para explorar similitudes y formular mejores
            preguntas.
          </p>
          <a
            href="https://github.com/SuperGallinazo27/velkaris-prometheus"
            target="_blank"
            rel="noreferrer"
          >
            Proyecto Python <span>↗</span>
          </a>
          <div className="version">
            VELKARIS <span>v0.1 · DEMO</span>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div>
            Workspace <span>/</span>{" "}
            <strong>{navigation.find((n) => n.id === view)?.name}</strong>
          </div>
          <span className="mode">
            <span /> Modo demostración
          </span>
        </header>
        <main id="main">
          <div className="page-heading">
            <div>
              <span className="eyebrow">
                INTELIGENCIA TERRITORIAL · CONCEPTO
              </span>
              <h1>
                {view === "explore"
                  ? "Explora mundos. Encuentra conexiones."
                  : view === "ranking"
                    ? "Compara los candidatos."
                    : view === "risks"
                      ? "Haz visibles las incertidumbres."
                      : "Diseña un escenario viable."}
              </h1>
              <p>
                {view === "explore"
                  ? "Del relieve marciano a los paisajes de la Tierra. Un espacio para explorar análogos."
                  : view === "ranking"
                    ? "Una distancia transparente entre descriptores, para comenzar la exploración."
                    : view === "risks"
                      ? "Una base para organizar preguntas antes de planificar una campaña."
                      : "Explora cómo cambian los costos de una campaña terrestre."}
              </p>
            </div>
            <button className="secondary" onClick={exportCsv}>
              <Icon name="download" size={17} /> Exportar demo
            </button>
          </div>
          <div className="demo-notice">
            <span className="demo-badge">DEMO</span>
            <p>
              Datos sintéticos, sin validación científica. No contiene datos
              NASA ni predice anomalías.
            </p>
            <span className="notice-end">Solo exploración</span>
          </div>
          {view !== "economy" && (
            <section className="region-bar" aria-label="Región de referencia">
              <div>
                <span className="eyebrow">01 / REFERENCIA PLANETARIA</span>
                <label htmlFor="region">Región a comparar</label>
              </div>
              <select
                id="region"
                value={regionId}
                onChange={(e) => setRegionId(e.target.value)}
              >
                {regions.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} · Marte
                  </option>
                ))}
              </select>
              <div className="region-feature">
                <small>Relieve sintético</small>
                <strong>
                  {region.relief.toLocaleString("es")} <span>m</span>
                </strong>
              </div>
              <div className="region-feature">
                <small>Pendiente sintética</small>
                <strong>
                  {region.slope}
                  <span>°</span>
                </strong>
              </div>
              <div className="region-feature">
                <small>Rugosidad sintética</small>
                <strong>
                  {region.roughness} <span>m</span>
                </strong>
              </div>
            </section>
          )}
          {view === "explore" && (
            <>
              <div className="section-title">
                <div>
                  <span className="eyebrow">02 / EXPLORACIÓN TERRESTRE</span>
                  <h2>Un planeta. Múltiples posibilidades.</h2>
                </div>
                <span className="small-label">3 candidatos de ejemplo</span>
              </div>
              <div className="explore-grid">
                <section className="map-panel">
                  <AnalogMap selected={selectedId} onSelect={setSelectedId} />
                  <div className="map-footer">
                    <Icon name="globe" size={16} />
                    <span>Vista global</span>
                    <span>Selecciona un punto para explorar</span>
                  </div>
                </section>
                <section className="panel selected-panel">
                  <div className="panel-heading">
                    <span className="eyebrow">CANDIDATO SELECCIONADO</span>
                    <span className="tag">DEMO</span>
                  </div>
                  <span className="site-number">
                    {String(selected.rank).padStart(2, "0")}
                    <small>/ RANKING</small>
                  </span>
                  <h2>{selected.site.name}</h2>
                  <p className="muted">{selected.site.context}</p>
                  <div className="distance">
                    <span>Distancia ilustrativa</span>
                    <strong>{selected.distance.toFixed(3)}</strong>
                    <small>Menor valor = mayor proximidad en el modelo</small>
                  </div>
                  <dl className="site-details">
                    <div>
                      <dt>Relieve</dt>
                      <dd>{selected.site.relief} m</dd>
                    </div>
                    <div>
                      <dt>Pendiente</dt>
                      <dd>{selected.site.slope}°</dd>
                    </div>
                    <div>
                      <dt>Rugosidad</dt>
                      <dd>{selected.site.roughness} m</dd>
                    </div>
                  </dl>
                  <button
                    className="primary"
                    onClick={() => setView("ranking")}
                  >
                    Ver comparación <Icon name="arrow" size={18} />
                  </button>
                </section>
              </div>
              <div className="next-grid">
                <button onClick={() => setView("risks")}>
                  <Icon name="risks" />
                  <div>
                    <h3>Entiende los riesgos</h3>
                    <p>Una matriz ilustrativa de incertidumbres.</p>
                  </div>
                  <Icon name="arrow" />
                </button>
                <button onClick={() => setView("economy")}>
                  <Icon name="economy" />
                  <div>
                    <h3>Explora la economía</h3>
                    <p>Ajusta recursos, duración y contingencia.</p>
                  </div>
                  <Icon name="arrow" />
                </button>
              </div>
            </>
          )}
          {view === "ranking" && (
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <span className="eyebrow">02 / CANDIDATOS TERRESTRES</span>
                  <h2>Ranking exploratorio</h2>
                </div>
                <label className="search">
                  <span className="sr-only">Buscar candidato</span>
                  <input
                    placeholder="Buscar candidato…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </label>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Posición</th>
                      <th>Candidato</th>
                      <th>Relieve (m)</th>
                      <th>Pendiente (°)</th>
                      <th>Rugosidad (m)</th>
                      <th>Distancia ↓</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((row) => (
                      <tr key={row.site.id}>
                        <td>
                          <span className="rank-badge">{row.rank}</span>
                        </td>
                        <td>
                          <button
                            className="text-button"
                            onClick={() => {
                              setSelectedId(row.site.id);
                              setView("explore");
                            }}
                          >
                            {row.site.name}
                          </button>
                          <small>{row.site.context}</small>
                        </td>
                        <td>{row.site.relief}</td>
                        <td>{row.site.slope}</td>
                        <td>{row.site.roughness}</td>
                        <td>
                          <strong>{row.distance.toFixed(3)}</strong>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!filtered.length && (
                  <p className="empty">
                    No hay candidatos que coincidan con tu búsqueda.
                  </p>
                )}
              </div>
              <div className="method">
                <h3>¿Cómo se calcula?</h3>
                <p>
                  Promedio de las diferencias absolutas de relieve / 1000 m,
                  pendiente / 15° y rugosidad / 100 m. Pesos iguales, escalas
                  ilustrativas. Los empates comparten posición.
                </p>
                <p>
                  El resultado no es un porcentaje de similitud ni una
                  probabilidad. No compara clima, geología ni habitabilidad.
                </p>
              </div>
            </section>
          )}
          {view === "risks" && (
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <span className="eyebrow">02 / MATRIZ ILUSTRATIVA</span>
                  <h2>Preguntas antes de avanzar</h2>
                </div>
                <span className="tag">SIN EVALUACIÓN REAL</span>
              </div>
              <p className="muted">
                Estos valores ficticios son comunes a todos los escenarios. No
                se calculan a partir de la región seleccionada.
              </p>
              <div className="risk-grid">
                {demoRisks.map((risk) => (
                  <article className="risk-card" key={risk.name}>
                    <div className="panel-heading">
                      <Icon name="risks" />
                      <span className={`risk-level level-${risk.value}`}>
                        {risk.level} · demo
                      </span>
                    </div>
                    <h3>{risk.name}</h3>
                    <p>{risk.detail}</p>
                    <div
                      className="risk-meter"
                      aria-label={`Nivel ilustrativo ${risk.value} de 3`}
                    >
                      {[1, 2, 3].map((i) => (
                        <span
                          key={i}
                          className={i <= risk.value ? "filled" : ""}
                        />
                      ))}
                    </div>
                  </article>
                ))}
              </div>
              <div className="method">
                <h3>Próximo paso: evidencia</h3>
                <p>
                  Definir criterios, fuentes, fecha, incertidumbre y revisión
                  experta antes de evaluar riesgos reales. No hay predicción de
                  actividad solar o geomagnética.
                </p>
              </div>
            </section>
          )}
          {view === "economy" && <Economy />}
          <footer>
            <span>
              PROMETHEUS <span className="footer-dot">/</span> Una iniciativa
              VELKARIS
            </span>
            <span>Datos demo · sin conexión a NASA · sin API activa</span>
          </footer>
        </main>
      </div>
    </div>
  );
}
