import { analogSourceOf } from "./analogSource";
import type { AnalogOf } from "./analogSource";

const BADGE: Record<AnalogOf, string> = {
  Luna: "Análogo de la Luna",
  Marte: "Análogo de Marte",
  "Luna y Marte": "Análogo de la Luna y de Marte",
};

/** Primera sección de la pestaña Terreno: por qué este lugar es un análogo, con su fuente. */
export function AnalogSourcePanel({ placeId }: { placeId: string }) {
  const entry = analogSourceOf(placeId);
  if (!entry) return null;
  const { analogOf, why, source, note } = entry;

  return (
    <section className="analogo-fuente" aria-labelledby="analogo-fuente-t">
      <header>
        <h3 id="analogo-fuente-t">Por qué es un sitio análogo</h3>
        {analogOf && <span className="nc-insignia">{BADGE[analogOf]}</span>}
      </header>
      {source ? (
        <>
          <p>{why}</p>
          <p className="nc-nota">
            Fuente:{" "}
            <a href={source.url} target="_blank" rel="noreferrer">
              {source.title}
            </a>{" "}
            · {source.publisher}
            {source.year ? ` (${source.year})` : ""}.{note ? ` ${note}` : ""}
          </p>
        </>
      ) : (
        <p className="nc-nota">
          No encontramos una publicación que lo documente como sitio análogo. Está en la lista como candidato por su
          terreno, y su similitud la calcula PROMETHEUS con el relieve real.
        </p>
      )}
      {analogOf === "Marte" && (
        <p className="nc-nota">
          Está documentado como análogo de Marte. Con la Luna, lo que cuenta es la coincidencia de terreno calculada.
        </p>
      )}
    </section>
  );
}
