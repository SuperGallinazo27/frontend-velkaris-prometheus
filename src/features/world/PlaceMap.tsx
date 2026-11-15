import { useEffect, useRef, useState } from "react";
import type { CSSProperties, RefObject } from "react";
import { decimal } from "./format";
import { BASES, EXAGGERATION, SATELLITE_SOUTH_LIMIT, TERRAIN_CREDIT, createPlaceMap, dailyImageDate } from "./placeEngine";
import type { Base, PlaceMapHandle } from "./placeEngine";
import "./place.css";

type Status = "cargando" | "listo" | "error";

export interface PlaceMapProps {
  name: string;
  latitude: number;
  longitude: number;
  /** Semilado del área analizada, en metros. */
  halfM: number;
  /** Espacio que tapan los paneles a cada lado, en píxeles. */
  left: number;
  right: number;
  top: number;
  bottom: number;
  calm: boolean;
  /** Pantalla estrecha: los créditos se pliegan para no tapar el mapa. */
  compact: boolean;
  onBack: () => void;
  /** Para que los botones de acercamiento de la pantalla muevan este mapa. */
  handleRef: RefObject<PlaceMapHandle | null>;
}

const longDate = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("es", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

/**
 * El lugar elegido, visto de cerca: satélite sobre relieve 3D, con el recuadro del área analizada.
 * Se monta con `key` por lugar. Es el archivo que carga MapLibre, así que se importa bajo demanda.
 */
export default function PlaceMap(props: PlaceMapProps) {
  const { name, latitude, longitude, halfM, left, right, top, bottom, calm, compact, onBack, handleRef } = props;
  const hasSatellite = latitude >= SATELLITE_SOUTH_LIMIT;
  const [base, setBase] = useState<Base>(hasSatellite ? "satelite" : "hoy");
  const [tilted, setTilted] = useState(true);
  const [status, setStatus] = useState<Status>("cargando");
  const containerRef = useRef<HTMLDivElement>(null);
  // Los valores iniciales se leen una vez al crear el mapa; después llegan por los efectos de abajo.
  const initial = useRef({ name, latitude, longitude, halfM, base, calm, padding: { left, right, top, bottom } });

  useEffect(() => {
    if (!containerRef.current) return;
    const handle = createPlaceMap({
      container: containerRef.current,
      ...initial.current,
      onReady: () => setStatus("listo"),
      // Sin WebGL el mapa no se puede crear: la ficha y los enlaces siguen disponibles.
      onError: () => setStatus("error"),
    });
    handleRef.current = handle;
    return () => {
      handleRef.current = null;
      handle.dispose();
    };
  }, [handleRef]);

  useEffect(() => {
    handleRef.current?.setBase(base);
  }, [base, handleRef]);

  useEffect(() => {
    handleRef.current?.setTilt(tilted);
  }, [tilted, handleRef]);

  useEffect(() => {
    handleRef.current?.setPadding({ left, right, top, bottom });
  }, [left, right, top, bottom, handleRef]);

  const info = BASES.find((b) => b.id === base)!;
  // La barra queda justo encima del espacio que el mapa reserva arriba.
  const insets = { "--lugar-izq": `${left}px`, "--lugar-der": `${right}px`, "--lugar-barra": `${top - 56}px` } as CSSProperties;

  return (
    <div className={`lugar ${status}`} style={insets}>
      <div
        className="lugar-lienzo"
        ref={containerRef}
        role="application"
        aria-label={`Mapa de ${name}. Arrastra para moverlo, usa la rueda para acercar y el botón derecho para girar.`}
      />

      <div className="lugar-barra">
        <button type="button" className="lugar-volver" onClick={onBack}>
          <span aria-hidden="true">←</span> Volver al globo
        </button>
        <div className="lugar-capas" role="group" aria-label="Tipo de mapa">
          {BASES.map((item) => {
            const unavailable = item.id === "satelite" && !hasSatellite;
            return (
              <button
                key={item.id}
                type="button"
                aria-pressed={base === item.id}
                disabled={unavailable}
                title={unavailable ? "El mosaico satelital no cubre la Antártida" : undefined}
                onClick={() => setBase(item.id)}
              >
                {item.name}
              </button>
            );
          })}
        </div>
        <button type="button" className="lugar-3d" aria-pressed={tilted} onClick={() => setTilted((on) => !on)}>
          Relieve 3D
        </button>
      </div>

      {status === "cargando" && <p className="lugar-estado">Cargando el mapa del lugar…</p>}
      {status === "error" && (
        <p className="lugar-estado" role="alert">
          Este navegador no puede mostrar el mapa 3D. La ficha y los enlaces al mapa siguen disponibles.
        </p>
      )}

      <details className="lugar-credito" open={!compact}>
        <summary>
          <span className="lugar-clave">
            <i aria-hidden="true" /> Área analizada: {decimal((halfM * 2) / 1000)} km
          </span>
          <span>Créditos del mapa</span>
        </summary>
        <p>
          <span className="lugar-clave">
            <i aria-hidden="true" /> Área analizada: {decimal((halfM * 2) / 1000)} km de lado
          </span>
          {base === "hoy" && <span>Imagen del {longDate(dailyImageDate())}, a 250 m por píxel</span>}
          {tilted && <span>Relieve exagerado ×{decimal(EXAGGERATION, 1)}</span>}
          <a href={info.creditUrl} target="_blank" rel="noreferrer">
            {info.credit}
          </a>
          {tilted && (
            <a href={TERRAIN_CREDIT.creditUrl} target="_blank" rel="noreferrer">
              {TERRAIN_CREDIT.credit}
            </a>
          )}
        </p>
      </details>
    </div>
  );
}
