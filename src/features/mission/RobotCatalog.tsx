import { useEffect, useRef } from "react";
import { ROBOTS, ROBOT_GROUPS } from "./robots";
import type { RobotEntry } from "./robots";

interface Props {
  /** Robot elegido ahora. */
  current: string;
  onPick: (robot: RobotEntry) => void;
  onClose: () => void;
}

/**
 * Catálogo de robots del simulador, con la clasificación del Excel del equipo: operativos,
 * planificados y prototipos, más el carro lunar como referencia. Los que no tienen datos
 * publicados para el modelo rueda-suelo aparecen con el motivo, sin poder elegirse.
 */
export function RobotCatalog({ current, onPick, onClose }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  return (
    <div className="sim-velo" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div
        className="sim-catalogo"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sim-catalogo-titulo"
        tabIndex={-1}
        ref={panelRef}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          // Cierra solo el catálogo, no el centro de misión.
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }}
      >
        <header>
          <div>
            <h3 id="sim-catalogo-titulo">Catálogo de robots</h3>
            <p>
              Clasificación y datos del catálogo técnico del equipo, con fuentes de NASA y JPL. Solo se simulan los robots
              con masa y ruedas publicadas: lo que falta no se inventa.
            </p>
          </div>
          <button type="button" className="sim-icono" aria-label="Cerrar el catálogo" onClick={onClose}>
            ✕
          </button>
        </header>
        <div className="sim-catalogo-cuerpo">
          {ROBOT_GROUPS.map((group) => {
            const robots = ROBOTS.filter((robot) => robot.group === group.id);
            return (
              <section key={group.id} aria-label={group.id}>
                <h4>
                  {group.id} <small>{group.detail}</small>
                </h4>
                <ul>
                  {robots.map((robot) => (
                    <li key={robot.id} className={robot.vehicle ? (robot.id === current ? "elegido" : undefined) : "sin-datos"}>
                      <div className="sim-ficha-cabeza">
                        <strong>{robot.name}</strong>
                        <span>{robot.type}</span>
                      </div>
                      <p className="sim-ficha-estado">
                        {robot.status} · {robot.destination}
                      </p>
                      <dl>
                        <div>
                          <dt>Masa</dt>
                          <dd>{robot.mass}</dd>
                        </div>
                        <div>
                          <dt>Tamaño</dt>
                          <dd>{robot.size}</dd>
                        </div>
                        <div>
                          <dt>Movilidad</dt>
                          <dd>{robot.locomotion}</dd>
                        </div>
                        <div>
                          <dt>Velocidad</dt>
                          <dd>{robot.speed}</dd>
                        </div>
                        <div>
                          <dt>Terrenos</dt>
                          <dd>{robot.terrains}</dd>
                        </div>
                      </dl>
                      <p className="sim-ficha-uso" title={`Energía: ${robot.power}. Pendiente: ${robot.slope}.`}>
                        {robot.purpose}.
                      </p>
                      {robot.vehicle ? (
                        <p className="sim-ficha-modelo">{robot.model?.kind === "nasa" ? `${robot.model.credit}.` : robot.model?.note}</p>
                      ) : (
                        <p className="sim-ficha-bloqueo">{robot.blocked}</p>
                      )}
                      <div className="sim-ficha-pie">
                        {robot.vehicle && (
                          <button
                            type="button"
                            className="nc-btn primario compacto"
                            aria-pressed={robot.id === current}
                            onClick={() => onPick(robot)}
                          >
                            {robot.id === current ? "En el simulador" : "Usar este robot"}
                          </button>
                        )}
                        <a href={robot.source.url} target="_blank" rel="noreferrer" title={robot.source.label}>
                          Fuente ↗
                        </a>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
