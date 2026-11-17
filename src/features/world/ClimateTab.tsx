import type { Season as SeasonData } from "./climate";
import { GroundTemp } from "./GroundTemp";
import { Now } from "./Now";
import { Season } from "./Season";
import type { ClimateNow } from "./useClimateNow";
import "./clima.css";

interface Props {
  now: ClimateNow;
  zoneId: string;
  latitude: number;
  longitude: number;
  /** Altitud del lugar, si se conoce. */
  elevation: number | null;
  /** Clima típico del lugar; null si aún no se calculó. */
  season: SeasonData | null;
  /** Región lunar con la que se compara, para la temperatura del suelo. */
  region: { id: string; name: string } | null;
}

/**
 * Pestaña «Clima» de un lugar, en tres bloques que no se pisan:
 *
 * 1. **Ahora:** datos reales de hoy (tiempo, estado del suelo, lluvia de 30 días frente a esas
 *    mismas fechas en años anteriores, El Niño) y una sola valoración para trabajo de campo.
 * 2. **Clima típico:** el promedio de muchos años, rotulado siempre como típico. En el mes actual
 *    repite la valoración de hoy, para que nadie lea «favorable» donde hoy es «difícil».
 * 3. **Temperatura del suelo:** la de aquí y la de la región lunar.
 *
 * Se monta con `key` por lugar, así que cada lugar empieza consultando de nuevo.
 */
export function ClimateTab({ zoneId, latitude, longitude, elevation, season, region, now }: Props) {
  return (
    <div className="clima">
      <Now now={now} latitude={latitude} longitude={longitude} season={season} />
      {season ? (
        <Season season={season} elevation={elevation} current={now.month} today={now.today}  />
      ) : (
        <p className="nc-nota">Este lugar aún no tiene clima típico calculado.</p>
      )}
      <GroundTemp zoneId={zoneId} region={region} />
    </div>
  );
}
