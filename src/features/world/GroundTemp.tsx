import { useState } from "react";
import { decimal } from "./format";
import { QUARTER_NAMES, groundOf, groundSource, moonGroundOf, moonGroundSource, quarterOfMonth } from "./ground";

interface Props {
  zoneId: string;
  /** Región lunar con la que se compara, cuando el terreno es real. */
  region: { id: string; name: string } | null;
}

/** Con el signo menos tipográfico, que no se confunde con un guion. */
const celsius = (value: number | null) => (value === null ? "—" : `${decimal(value).replace("-", "−")} °C`);

/**
 * Temperatura del suelo del lugar, medida por satélite, y la de la región lunar con la que se
 * compara. Son ocho números (día y noche de cuatro trimestres): van en una tabla, que se lee
 * mejor que un gráfico.
 */
export function GroundTemp({ zoneId, region }: Props) {
  const [quarter] = useState(() => quarterOfMonth(new Date().getMonth()));
  const ground = groundOf(zoneId);
  const moon = region ? moonGroundOf(region.id) : null;
  if (!ground) return null;

  return (
    <section className="suelo-temp" aria-labelledby="suelo-temp-t">
      <header>
        <h3 id="suelo-temp-t">Temperatura del suelo</h3>
        <span className="nc-nota">Satélite MODIS, 1 km</span>
      </header>

      {ground.hottest && ground.coldest && (
        <p className="suelo-temp-frase">
          Aquí el suelo llega a <strong>{celsius(ground.hottest.value)}</strong> de día ({QUARTER_NAMES[ground.hottest.quarter]}) y
          baja a <strong>{celsius(ground.coldest.value)}</strong> de noche ({QUARTER_NAMES[ground.coldest.quarter]}).
        </p>
      )}

      <div className="suelo-temp-tabla">
        <table>
          <thead>
            <tr>
              <td />
              {QUARTER_NAMES.map((name, index) => (
                <th key={name} scope="col" className={index === quarter ? "actual" : undefined}>
                  {name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">Día</th>
              {ground.quarters.map((q) => (
                <td key={q.index} className={q.index === quarter ? "actual" : undefined}>
                  {celsius(q.day)}
                </td>
              ))}
            </tr>
            <tr>
              <th scope="row">Noche</th>
              {ground.quarters.map((q) => (
                <td key={q.index} className={q.index === quarter ? "actual" : undefined}>
                  {celsius(q.night)}
                </td>
              ))}
            </tr>
            <tr>
              <th scope="row">Salto</th>
              {ground.quarters.map((q) => (
                <td key={q.index} className={q.index === quarter ? "actual" : undefined}>
                  {celsius(q.swing)}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      {region && moon && (
        <p className="suelo-temp-luna">
          <strong>En {region.name} (Luna)</strong> el suelo va de {celsius(moon.min)} a {celsius(moon.max)} a lo largo de su
          día: un salto de {decimal(moon.swing)} °C
          {ground.widestSwing !== null && `, frente a los ${decimal(ground.widestSwing)} °C de aquí`}. Ningún lugar de la
          Tierra reproduce ese frío: aquí se prueba la forma del terreno, no la temperatura.
        </p>
      )}

      <p className="nc-nota">
        Aquí: media de día y de noche de cada trimestre en el recuadro de 18 km (
        <a href={groundSource.url} target="_blank" rel="noreferrer">
          MODIS
        </a>
        , temperatura de la superficie; los archivos no indican de qué años son). Es el suelo, no el aire: de día, el suelo
        desnudo se calienta bastante más que el aire.
        {region &&
          moon &&
          ` Luna: valor típico de ${moon.cells} ${moon.cells === 1 ? "celda" : "celdas"} de 0,5° del radiómetro `}
        {region && moon && (
          <a href={moonGroundSource.url} target="_blank" rel="noreferrer">
            Diviner
          </a>
        )}
        {region && moon && ` de NASA (${moonGroundSource.period.replace("-", "–")}); en los polos, el fondo de los cráteres en sombra es aún más frío.`}
      </p>
    </section>
  );
}
