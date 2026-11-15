import type { PlaceStatus } from "../../services/turnosRules";
import { STATE_MARK } from "./format";
import "./turnos.css";

/** Texto corto de cada estado que conviene avisar antes de entrar al lugar. */
const TEXT: Partial<Record<PlaceStatus["status"], string>> = {
  protegido: "Área protegida · no reservable",
  cerrado: "Cerrado · no reservable",
  sin_dato: "Sin consultar · no reservable",
  permiso: "Área protegida · requiere permiso",
  habilitado: "Área protegida · habilitado con permiso",
};

/**
 * Insignia de un lugar que no está simplemente libre: así un lugar bloqueado nunca parece
 * disponible. Un lugar libre no lleva insignia, salvo que su área de 18 km toque un área de
 * protección estricta o que hoy esté ocupado.
 */
export function PlaceBadge({ status }: { status: PlaceStatus | undefined }) {
  if (!status) return null;
  const fixed = TEXT[status.status];
  // Un lugar libre también avisa si su área de 18 km toca un área de protección estricta.
  const text = fixed ?? (status.nearbyStrict.length ? "Junto a área protegida" : status.occupiedToday ? "Ocupado hoy" : null);
  if (!text) return null;
  return (
    <span className={`turnos-insignia ${fixed ? STATE_MARK[status.status].tone : "medio"}`}>
      <i aria-hidden="true">{fixed ? STATE_MARK[status.status].symbol : "!"}</i>
      {text}
    </span>
  );
}
