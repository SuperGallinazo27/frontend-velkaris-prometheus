import { useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import { decimal } from "./format";

export interface SlipSeries {
  id: string;
  name: string;
  /** Da el color de la serie (clase CSS `serie-<tono>`). */
  tone: "luna" | "aqui";
  /** Patinaje (0 a 1) en cada pendiente; null donde se atasca. */
  slips: (number | null)[];
  /** Pendiente típica del lugar y su patinaje, para marcarla en la línea. */
  marker: { slope: number; slip: number | null } | null;
  /** Primera pendiente de la gráfica en la que ya no avanza; null si sube todas. */
  stuckFrom: number | null;
}

interface Props {
  slopes: readonly number[];
  series: SlipSeries[];
  /** Patinaje límite (0 a 1), dibujado como referencia. */
  limit: number;
  pending?: boolean;
}

const W = 330;
const H = 214;
const M = { top: 14, right: 14, bottom: 34, left: 42 };
const MAX_SLOPE = 30;
const Y_TICKS = [0, 0.25, 0.5, 0.75, 1];
const X_TICKS = [0, 10, 20, 30];

const x = (slope: number) => M.left + (slope / MAX_SLOPE) * (W - M.left - M.right);
const y = (slip: number) => M.top + (1 - slip) * (H - M.top - M.bottom);
const pct = (slip: number) => `${decimal(slip * 100)} %`;

/** Trazo de una serie, cortado donde el vehículo se atasca. */
function path(slopes: readonly number[], slips: (number | null)[]): string {
  let d = "";
  let drawing = false;
  slips.forEach((slip, k) => {
    if (slip === null) {
      drawing = false;
      return;
    }
    d += `${drawing ? "L" : "M"}${x(slopes[k]).toFixed(1)},${y(slip).toFixed(1)}`;
    drawing = true;
  });
  return d;
}

/**
 * Patinaje frente a pendiente para dos mundos. La guía vertical sigue al puntero (o a las flechas
 * del teclado) y el recuadro muestra el valor de todas las series en esa pendiente.
 */
export function SlipChart({ slopes, series, limit, pending = false }: Props) {
  const [active, setActive] = useState<number | null>(null);

  function onPointerMove(event: PointerEvent<SVGRectElement>) {
    const box = event.currentTarget.ownerSVGElement!.getBoundingClientRect();
    const slope = (((event.clientX - box.left) / box.width) * W - M.left) / (W - M.left - M.right) * MAX_SLOPE;
    let nearest = 0;
    slopes.forEach((s, k) => {
      if (Math.abs(s - slope) < Math.abs(slopes[nearest] - slope)) nearest = k;
    });
    setActive(nearest);
  }

  function onKeyDown(event: KeyboardEvent<SVGSVGElement>) {
    if (event.key === "Escape") return setActive(null);
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    setActive((current) => Math.min(slopes.length - 1, Math.max(0, (current ?? (step > 0 ? -1 : slopes.length)) + step)));
  }

  return (
    <figure className={`ruedas-grafica${pending ? " calculando" : ""}`}>
      <figcaption className="ruedas-leyenda">
        {series.map((s) => (
          <span key={s.id}>
            <i className={`clave serie-${s.tone}`} aria-hidden="true" />
            {s.name}
            {s.stuckFrom !== null && <small> · se atasca desde {s.stuckFrom}°</small>}
          </span>
        ))}
      </figcaption>
      <div className="ruedas-lienzo">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label="Patinaje de la rueda según la pendiente. Usa las flechas para recorrer los valores; también están en la tabla de abajo."
          tabIndex={0}
          onKeyDown={onKeyDown}
          onBlur={() => setActive(null)}
        >
          {Y_TICKS.map((tick) => (
            <g key={tick}>
              <line className="rejilla" x1={M.left} x2={W - M.right} y1={y(tick)} y2={y(tick)} />
              <text className="eje" x={M.left - 6} y={y(tick) + 3.5} textAnchor="end">
                {decimal(tick * 100)} %
              </text>
            </g>
          ))}
          {X_TICKS.map((tick) => (
            <text key={tick} className="eje" x={x(tick)} y={H - M.bottom + 15} textAnchor="middle">
              {tick}°
            </text>
          ))}
          <text className="eje titulo" x={W - M.right} y={H - 4} textAnchor="end">
            pendiente
          </text>

          <line className="limite" x1={M.left} x2={W - M.right} y1={y(limit)} y2={y(limit)} />
          <text className="eje" x={W - M.right} y={y(limit) - 5} textAnchor="end">
            límite {pct(limit)}
          </text>

          {series.map((s) => (
            <path key={s.id} className={`linea serie-${s.tone}`} d={path(slopes, s.slips)} />
          ))}
          {series.map(
            (s) =>
              s.marker &&
              s.marker.slip !== null &&
              s.marker.slope <= MAX_SLOPE && (
                <circle
                  key={s.id}
                  className={`marca serie-${s.tone}`}
                  cx={x(s.marker.slope)}
                  cy={y(s.marker.slip)}
                  r={4.5}
                />
              ),
          )}

          {active !== null && <line className="guia" x1={x(slopes[active])} x2={x(slopes[active])} y1={M.top} y2={H - M.bottom} />}
          <rect
            className="zona"
            x={M.left}
            y={M.top}
            width={W - M.left - M.right}
            height={H - M.top - M.bottom}
            onPointerMove={onPointerMove}
            onPointerLeave={() => setActive(null)}
          />
        </svg>
        {active !== null && (
          <div
            className={`ruedas-dato${x(slopes[active]) > W * 0.6 ? " izquierda" : ""}`}
            style={{ left: `${(x(slopes[active]) / W) * 100}%` }}
            role="status"
          >
            <strong>Pendiente {slopes[active]}°</strong>
            {series.map((s) => (
              <span key={s.id}>
                <i className={`clave serie-${s.tone}`} aria-hidden="true" />
                <b>{s.slips[active] === null ? "se atasca" : pct(s.slips[active]!)}</b> {s.name}
              </span>
            ))}
          </div>
        )}
      </div>
      <details className="ruedas-tabla">
        <summary>Ver los valores</summary>
        <table>
          <thead>
            <tr>
              <th scope="col">Pendiente</th>
              {series.map((s) => (
                <th scope="col" key={s.id}>
                  {s.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {slopes.map((slope, k) => (
              <tr key={slope}>
                <th scope="row">{slope}°</th>
                {series.map((s) => (
                  <td key={s.id}>{s.slips[k] === null ? "se atasca" : pct(s.slips[k]!)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
