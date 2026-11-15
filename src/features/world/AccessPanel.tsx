import { accessOf, accessRows, accessSource } from "./access";
import "./accesos.css";

/**
 * Cómo se llega al lugar: aeropuerto, carretera, poblado y hospital más cercanos, de OpenStreetMap.
 * Son cuatro datos sueltos: van en una lista, cada uno con su distancia.
 */
export function AccessPanel({ placeId }: { placeId: string }) {
  const access = accessOf(placeId);
  if (!access) return null;

  return (
    <section className="accesos" aria-labelledby="accesos-t">
      <header>
        <h3 id="accesos-t">Cómo se llega</h3>
        <span className="nc-nota">OpenStreetMap</span>
      </header>
      <dl>
        {accessRows(access).map((row) => (
          <div key={row.label} className={row.found ? undefined : "sin-dato"}>
            <dt>{row.label}</dt>
            <dd>{row.text}</dd>
          </div>
        ))}
      </dl>
      <p className="nc-nota">
        Distancias en línea recta desde el punto del lugar, no por carretera. Datos de{" "}
        <a href={accessSource.url} target="_blank" rel="noreferrer">
          © colaboradores de OpenStreetMap
        </a>
        , que mantienen voluntarios: en zonas remotas puede faltar un camino o un puesto de salud.
      </p>
    </section>
  );
}
