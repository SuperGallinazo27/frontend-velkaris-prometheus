/**
 * Estado de El Niño / La Niña (índices de NOAA).
 *
 * - Con servidor (`VITE_API_BASE_URL`), se pide en vivo a `/api/v1/climate/enso`, que lee las
 *   tablas del Climate Prediction Center de NOAA. NOAA no permite leerlas desde el navegador.
 * - Sin servidor, o si la consulta falla, se usa la copia con fecha de `src/data/enso.json`
 *   (`scripts/clima/enso.py`). La pantalla muestra siempre la fecha del dato.
 */
import snapshot from "../data/enso.json";
import type { EnsoData } from "../features/world/enso";

const apiBase = (import.meta.env?.VITE_API_BASE_URL as string | undefined)?.trim();

/** Copia guardada con la aplicación. */
export const ENSO_SNAPSHOT = snapshot as EnsoData;

/** Comprueba la forma de la respuesta del servidor; lanza un error si no sirve. */
export function parseEnso(body: unknown): EnsoData {
  // El servidor escribe `fetched_at`; la copia guardada, `fetchedAt`.
  const data = body as (Partial<EnsoData> & { fetched_at?: unknown }) | null;
  const recent = Array.isArray(data?.recent) ? data.recent : [];
  const valid = recent.every(
    (r) => typeof r?.season === "string" && Number.isFinite(r?.year) && Number.isFinite(r?.oni),
  );
  const fetchedAt = data?.fetched_at ?? data?.fetchedAt;
  if (!data || !recent.length || !valid || typeof fetchedAt !== "string") throw new Error("Respuesta sin índice ONI");
  const weekly = data.weekly;
  const weeklyOk =
    weekly &&
    typeof weekly.week === "string" &&
    Number.isFinite(weekly.nino12?.anomaly) &&
    Number.isFinite(weekly.nino34?.anomaly);
  return {
    fetchedAt,
    recent,
    weekly: weeklyOk ? weekly : null,
    source: data.source ?? ENSO_SNAPSHOT.source,
  };
}

let pending: Promise<EnsoData> | null = null;

/** El dato más reciente disponible. Nunca falla: si no hay servidor o no responde, devuelve la copia. */
export function fetchEnso(fetcher: typeof fetch = fetch, base: string | undefined = apiBase): Promise<EnsoData> {
  if (!base) return Promise.resolve(ENSO_SNAPSHOT);
  pending ??= fetcher(`${base.replace(/\/+$/, "")}/api/v1/climate/enso`)
    .then(async (response) => {
      if (!response.ok) throw new Error(`El servidor respondió ${response.status}`);
      return parseEnso(await response.json());
    })
    .catch(() => {
      pending = null;
      return ENSO_SNAPSHOT;
    });
  return pending;
}
