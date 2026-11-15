import { useEffect, useState } from "react";
import { RADIUS_M, fetchPhotos } from "../../services/photos";
import type { Photo } from "../../services/photos";

type State = { status: "cargando" } | { status: "error" } | { status: "ok"; photos: Photo[] };

/**
 * Fotos tomadas cerca del lugar, de Wikimedia Commons. Se monta con `key` por lugar,
 * así que cada lugar empieza en «cargando».
 */
export function Photos({ latitude, longitude }: { latitude: number; longitude: number }) {
  const [state, setState] = useState<State>({ status: "cargando" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetchPhotos(latitude, longitude)
      .then((photos) => !cancelled && setState({ status: "ok", photos }))
      .catch(() => !cancelled && setState({ status: "error" }));
    return () => {
      cancelled = true;
    };
  }, [latitude, longitude, attempt]);

  function retry() {
    setState({ status: "cargando" });
    setAttempt((n) => n + 1);
  }

  return (
    <section className="fotos" aria-labelledby="fotos-t" aria-busy={state.status === "cargando"}>
      <header>
        <h3 id="fotos-t">Fotos del lugar</h3>
        <span className="nc-nota">A menos de {RADIUS_M / 1000} km</span>
      </header>

      {state.status === "cargando" && <p className="nc-nota">Buscando fotos…</p>}

      {state.status === "error" && (
        <p className="mundo-clima-error">
          No se pudieron cargar las fotos. Revisa la conexión.
          <button type="button" onClick={retry}>
            Reintentar
          </button>
        </p>
      )}

      {state.status === "ok" && state.photos.length === 0 && (
        <p className="nc-nota">No hay fotos con ubicación cerca de este punto en Wikimedia Commons.</p>
      )}

      {state.status === "ok" && state.photos.length > 0 && (
        <ul className="fotos-lista">
          {state.photos.map((photo) => (
            <li key={photo.page}>
              <a href={photo.page} target="_blank" rel="noreferrer">
                <img src={photo.thumbnail} alt={photo.title} width={photo.width} height={photo.height} loading="lazy" />
                <span>
                  <strong>{photo.title}</strong>
                  <small>
                    {photo.author} · {photo.license}
                  </small>
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}

      <p className="nc-nota">
        Fotos de voluntarios en{" "}
        <a href="https://commons.wikimedia.org/" target="_blank" rel="noreferrer">
          Wikimedia Commons
        </a>
        , cada una con su autor y su licencia. No es una selección revisada: puede haber imágenes que no muestren el
        terreno.
      </p>
    </section>
  );
}
