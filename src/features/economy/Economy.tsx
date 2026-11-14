import { useState } from "react";
import { estimateBudget } from "./budget";
const usd = (value: number) =>
  new Intl.NumberFormat("es-EC", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
export function Economy() {
  const [days, setDays] = useState(7),
    [people, setPeople] = useState(6),
    [rate, setRate] = useState(120),
    [logistics, setLogistics] = useState(1800),
    [contingency, setContingency] = useState(15);
  const budget = estimateBudget(days, people, rate, logistics, contingency);
  return (
    <div className="economy-grid">
      <section className="panel">
        <div className="panel-heading">
          <h2>Configura una campaña</h2>
          <span className="tag">SUPUESTOS</span>
        </div>
        <p className="muted">
          Modelo ilustrativo de trabajo de campo en la Tierra. Ajusta los
          supuestos; no son cotizaciones.
        </p>
        <div className="sliders">
          {[
            {
              label: "Duración",
              value: days,
              set: setDays,
              min: 1,
              max: 30,
              unit: "días",
            },
            {
              label: "Equipo",
              value: people,
              set: setPeople,
              min: 1,
              max: 20,
              unit: "personas",
            },
            {
              label: "Costo por persona / día",
              value: rate,
              set: setRate,
              min: 0,
              max: 500,
              unit: "USD",
            },
            {
              label: "Logística fija",
              value: logistics,
              set: setLogistics,
              min: 0,
              max: 10000,
              unit: "USD",
            },
            {
              label: "Contingencia",
              value: contingency,
              set: setContingency,
              min: 0,
              max: 50,
              unit: "%",
            },
          ].map((item) => (
            <label key={item.label}>
              {item.label}
              <strong>
                {item.value} {item.unit}
              </strong>
              <input
                type="range"
                min={item.min}
                max={item.max}
                value={item.value}
                onChange={(e) => item.set(Number(e.target.value))}
              />
            </label>
          ))}
        </div>
      </section>
      <section className="panel budget">
        <span className="eyebrow">ESCENARIO ECONÓMICO DEMOSTRATIVO</span>
        <h2>Total estimado</h2>
        <div className="budget-total">{usd(budget.total)}</div>
        <p>USD · una campaña terrestre</p>
        <dl>
          {[
            ["Trabajo de campo", budget.fieldwork],
            ["Logística", budget.logistics],
            ["Contingencia", budget.reserve],
          ].map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{usd(Number(value))}</dd>
            </div>
          ))}
        </dl>
        <p className="budget-note">
          No incluye impuestos, seguros, permisos ni equipamiento especializado.
          No representa costos de una misión espacial.
        </p>
      </section>
    </div>
  );
}
