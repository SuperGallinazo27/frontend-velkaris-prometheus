import data from "../../data/candidatosGlobales.json";
import { coordinates, decimal } from "./format";
import { matchPercent } from "./hierarchy";
import "./candidates.css";

interface Candidate {
  latitude: number;
  longitude: number;
  /** Comarca o región, de OpenStreetMap; null si el mapa no la nombra. */
  area: string | null;
  country: string | null;
  relief: number;
  slope: number;
  roughness: number;
  elevation: number;
  rainMm: number;
  distance: number;
}

interface Entry {
  /** La región lunar medida a la misma escala gruesa que la Tierra. */
  coarse: { relief: number; slope: number; roughness: number };
  candidates: Candidate[];
}

const regions = data.regions as Record<string, Entry | undefined>;

const title = (candidate: Candidate) =>
  [candidate.area, candidate.country].filter(Boolean).join(", ") || "Zona sin nombre en el mapa";

/**
 * Búsqueda amplia: zonas de la Tierra que no están en la lista y cuyo relieve, a escala gruesa,
 * se parece al de la región lunar elegida (`scripts/buscador/calcular.py`). Son puntos de partida
 * para explorar, no lugares listos para una campaña, y la pantalla lo dice.
 */
export function Candidates({ regionId, regionName }: { regionId: string; regionName: string }) {
  const entry = regions[regionId];
  if (!entry?.candidates.length) return null;
  const { coverage, limits } = data;

  return (
    <details className="luna-candidatos">
      <summary>
        Más allá de la lista: {entry.candidates.length} zonas nuevas por explorar
      </summary>
      <p className="nc-nota">
        Se recorrió el relieve de la Tierra entre {Math.abs(coverage.latMin)}° S y {coverage.latMax}° N (
        {decimal(coverage.blocks)} bloques de unos 16 km) y se dejaron solo las zonas áridas (menos de {limits.aridMm} mm de
        lluvia al año), a más de {limits.awayFromListKm} km de los lugares de la lista. A esta escala gruesa, de unos 470 m,{" "}
        {regionName} mide {decimal(entry.coarse.relief)} m de relieve, {decimal(entry.coarse.slope, 1)}° de pendiente y{" "}
        {decimal(entry.coarse.roughness, 1)} m de rugosidad.
      </p>
      <ol>
        {entry.candidates.map((candidate) => (
          <li key={`${candidate.latitude},${candidate.longitude}`}>
            <strong>{title(candidate)}</strong>
            <span>
              {matchPercent(candidate.distance)} % de coincidencia a 470 m · relieve {decimal(candidate.relief)} m · pendiente{" "}
              {decimal(candidate.slope, 1)}° · rugosidad {decimal(candidate.roughness, 1)} m
            </span>
            <span>
              {decimal(candidate.elevation)} m de altitud · {decimal(candidate.rainMm)} mm de lluvia al año
            </span>
            <a
              href={`https://www.openstreetmap.org/?mlat=${candidate.latitude}&mlon=${candidate.longitude}#map=10/${candidate.latitude}/${candidate.longitude}`}
              target="_blank"
              rel="noreferrer"
            >
              {coordinates(candidate.latitude, candidate.longitude)} · ver en el mapa
            </a>
          </li>
        ))}
      </ol>
      <p className="nc-nota">
        <strong>Son zonas por explorar, no lugares listos.</strong> Aquí solo se comparó la forma del terreno a 470 m; al
        medirla a 30 m, la coincidencia puede bajar. Falta revisar clima, suelo, accesos y áreas protegidas, y los datos
        solo cubren esa franja de latitudes. Fuentes:{" "}
        <a href={data.sources.earth.url} target="_blank" rel="noreferrer">
          ETOPO 2022
        </a>{" "}
        (NOAA), LOLA (NASA),{" "}
        <a href={data.sources.rain.url} target="_blank" rel="noreferrer">
          WorldClim 2.1
        </a>{" "}
        y nombres de{" "}
        <a href={data.sources.names.url} target="_blank" rel="noreferrer">
          OpenStreetMap
        </a>
        .
      </p>
    </details>
  );
}
