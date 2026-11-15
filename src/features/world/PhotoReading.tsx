import { ROCK_COVER, ROCK_SIZE, SURFACES, VEGETATION, readPhotosOf, readingOf, readingSource } from "./terrainReading";
import type { ReadPhoto } from "./terrainReading";
import "./lectura.css";

const CONFIDENCE = { baja: "Baja", media: "Media", alta: "Alta" } as const;

const percent = (fraction: number) => `${Math.round(fraction * 100)} %`;

function tag(photo: ReadPhoto): { text: string; tone: string } {
  if (photo.close) return { text: "Suelo de cerca", tone: "cerca" };
  if (photo.useful) return { text: "Suelo de lejos", tone: "lejos" };
  return { text: "No muestra el suelo", tone: "no" };
}

/**
 * Lo que una IA vio en las fotos reales del lugar: qué cubre el suelo, cuántas rocas sueltas hay
 * y de qué tamaño. Va con las fotos revisadas como evidencia y con su nivel de confianza, porque
 * es una estimación y no una medición. El simulador la usa para poner las rocas.
 */
export function PhotoReading({ placeId }: { placeId: string }) {
  const reading = readingOf(placeId);
  const photos = readPhotosOf(placeId);
  if (!photos.length) return null;

  return (
    <section className="lectura" aria-labelledby="lectura-t">
      <header>
        <h3 id="lectura-t">Lectura del terreno con IA</h3>
        <span className="nc-nota">
          {reading ? `${reading.usefulPhotos} de ${reading.totalPhotos} fotos servían` : `${photos.length} fotos revisadas`}
        </span>
      </header>

      {reading ? (
        <>
          <dl className="lectura-datos">
            <div>
              <dt>Superficie</dt>
              <dd>
                {SURFACES[reading.surface]}
                {reading.secondary && `, con ${SURFACES[reading.secondary]}`}
              </dd>
            </div>
            <div>
              <dt>Rocas sueltas</dt>
              <dd>
                {reading.rockCover === null
                  ? "No se distinguen: ninguna foto muestra el suelo de cerca"
                  : `${ROCK_COVER[reading.rockCover].name} (${percent(ROCK_COVER[reading.rockCover].range[0])} a ${percent(ROCK_COVER[reading.rockCover].range[1])} del suelo)`}
                {reading.rockSize && ` · ${ROCK_SIZE[reading.rockSize].name}`}
              </dd>
            </div>
            <div>
              <dt>Vegetación</dt>
              <dd>{VEGETATION[reading.vegetation]}</dd>
            </div>
            <div>
              <dt>Agua, barro o nieve</dt>
              <dd>{reading.wet ? "Se ven en alguna foto" : "No se ven en las fotos"}</dd>
            </div>
            <div>
              <dt>Confianza</dt>
              <dd>
                {CONFIDENCE[reading.confidence]} · {reading.closePhotos}{" "}
                {reading.closePhotos === 1 ? "foto muestra" : "fotos muestran"} el suelo de cerca
              </dd>
            </div>
          </dl>
          {reading.note && <p className="lectura-nota">«{reading.note}»</p>}
        </>
      ) : (
        <p className="nc-nota">
          Ninguna de las fotos cercanas deja ver el suelo lo bastante para describirlo. No hay lectura: el simulador
          usa rocas de práctica.
        </p>
      )}

      <details className="lectura-fotos">
        <summary>Ver las {photos.length} fotos revisadas y qué vio la IA en cada una</summary>
        <ul>
          {photos.map((photo) => {
            const label = tag(photo);
            return (
              <li key={photo.page}>
                <a href={photo.page} target="_blank" rel="noreferrer">
                  <img src={photo.thumbnail} alt="" loading="lazy" width={96} height={72} />
                </a>
                <div>
                  <span className={`lectura-etiqueta ${label.tone}`}>{label.text}</span>
                  <p>{photo.seen}</p>
                  <small>
                    <a href={photo.page} target="_blank" rel="noreferrer">
                      {photo.title}
                    </a>{" "}
                    · {photo.author} · {photo.license}
                  </small>
                </div>
              </li>
            );
          })}
        </ul>
      </details>

      <p className="nc-nota">
        Es una <strong>estimación</strong>, no una medición: un modelo de IA de Google ({readingSource.model}) revisó
        fotos de Wikimedia Commons tomadas a menos de 10 km, que pueden mostrar sitios distintos dentro de esa
        distancia. Las rocas solo se cuentan en las fotos que enseñan el suelo de cerca. El simulador usa esta lectura
        para decidir cuántas rocas pone y de qué tamaño; el relieve de 30 m no las ve.
      </p>
    </section>
  );
}
