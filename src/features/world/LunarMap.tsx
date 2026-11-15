import { useState } from "react";
import type { CSSProperties } from "react";
import { Candidates } from "./Candidates";
import { coordinates, decimal, percent } from "./format";
import { moonGroundOf, moonGroundSource } from "./ground";
import { LUNAR_ZONES, lunarMaps, regionsOf, zoneInfo } from "./lunar";
import type { LunarMapInfo, LunarRegion, LunarZone } from "./lunar";
import northUrl from "./polo-norte-lunar.webp";
import southUrl from "./polo-sur-lunar.webp";
import centralUrl from "./zona-central-lunar.webp";
import rugosidad from "../../data/rugosidadLola.json";

/** Rugosidad fina de cada región, medida por el láser LOLA a escala de 25 m (scripts/luna/calcular.py). */
const fineRoughness = rugosidad.regions as Record<string, { median: number; q1: number; q3: number; pixels: number } | null>;

const IMAGES: Record<LunarZone, string> = { sur: southUrl, norte: northUrl, central: centralUrl };

const area = (region: LunarRegion) => (region.box.xMax - region.box.xMin) * (region.box.yMax - region.box.yMin);

/** Dónde va la etiqueta de las regiones que quedan pegadas a otras, como en el mapa de la NASA. */
const LABEL_PLACE: Record<string, string> = {
  "mons-mouton-plateau": "encima",
  "mons-mouton": "lado-izq",
  "nobile-rim-1": "lado-der",
  "malapert-massif": "encima",
  haworth: "encima",
  whipple: "encima",
  aristarchus: "encima",
  "mons-hadley": "encima",
};

/** Posición de un recuadro dentro de la imagen, en porcentaje, a partir de las unidades del mapa. */
function place(region: LunarRegion, map: LunarMapInfo): CSSProperties {
  const width = map.xMax - map.xMin;
  const height = map.yMax - map.yMin;
  const { box } = region;
  return {
    left: `${(((box.xMin + box.xMax) / 2 - map.xMin) / width) * 100}%`,
    top: `${((map.yMax - (box.yMin + box.yMax) / 2) / height) * 100}%`,
    width: `${((box.xMax - box.xMin) / width) * 100}%`,
    height: `${((box.yMax - box.yMin) / height) * 100}%`,
  };
}

/** Hacia qué lado se abre la etiqueta para no salirse de la tarjeta. */
function side(region: LunarRegion, map: LunarMapInfo): string {
  if (LABEL_PLACE[region.id]) return LABEL_PLACE[region.id];
  const center = ((region.box.xMin + region.box.xMax) / 2 - map.xMin) / (map.xMax - map.xMin);
  return center < 0.25 ? "izquierda" : center > 0.75 ? "derecha" : "centro";
}

interface Props {
  selected: LunarRegion;
  open: boolean;
  onToggle: () => void;
  onSelect: (id: string) => void;
}

/**
 * Mapa real de una zona de la Luna para elegir la región de referencia: el polo sur con las
 * candidatas de Artemis III, el polo norte o la zona central de la cara visible.
 */
export function LunarMap({ selected, open, onToggle, onSelect }: Props) {
  // Ampliado, el mapa crece y muestra el nombre de todas las regiones a la vez.
  const [large, setLarge] = useState(false);
  const zone = zoneInfo(selected.zone);
  const map = lunarMaps[zone.id];
  // Los recuadros grandes van primero para que los pequeños que caen dentro queden encima.
  const ordered = [...regionsOf(zone.id)].sort((a, b) => area(b) - area(a));

  return (
    <section
      className={`luna-mapa nc-tarjeta${open && large ? " grande" : ""}`}
      aria-label="Región lunar de referencia"
    >
      <header>
        <div>
          <span className="nc-eyebrow">Luna · {zone.name}</span>
          <strong>{selected.name}</strong>
        </div>
        <div className="luna-botones">
          {open && (
            <button type="button" className="luna-alternar luna-ampliar" aria-pressed={large} onClick={() => setLarge((on) => !on)}>
              {large ? "Reducir" : "Ampliar"}
            </button>
          )}
          <button type="button" className="luna-alternar" aria-expanded={open} onClick={onToggle}>
            {open ? "Ocultar mapa" : "Ver mapa"}
          </button>
        </div>
      </header>

      {open && (
        <>
          <div className="luna-zonas" role="group" aria-label="Zona de la Luna">
            {LUNAR_ZONES.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-pressed={item.id === zone.id}
                title={item.detail}
                onClick={() => item.id !== zone.id && onSelect(item.first)}
              >
                {item.name}
              </button>
            ))}
          </div>

          <div className={`luna-lienzo zona-${zone.id}`} style={{ aspectRatio: `${map.width} / ${map.height}` }}>
            <img
              src={IMAGES[zone.id]}
              width={map.width}
              height={map.height}
              alt={`Relieve de la Luna, ${zone.name.toLowerCase()}, con sus regiones de referencia`}
            />
            {ordered.map((region) => (
              <button
                key={region.id}
                type="button"
                className={`luna-region ${side(region, map)}`}
                aria-pressed={region.id === selected.id}
                aria-label={region.name}
                data-nombre={region.name}
                style={place(region, map)}
                onClick={() => onSelect(region.id)}
              />
            ))}
            {map.pole && (
              <span
                className="luna-polo"
                style={{
                  left: `${((map.pole.x - map.xMin) / (map.xMax - map.xMin)) * 100}%`,
                  top: `${((map.yMax - map.pole.y) / (map.yMax - map.yMin)) * 100}%`,
                }}
                aria-hidden="true"
              >
                <i>{zone.name}</i>
              </span>
            )}
            <span className="luna-escala" style={{ width: `${(map.scale.units / (map.xMax - map.xMin)) * 100}%` }} aria-hidden="true">
              {map.scale.km} km
            </span>
          </div>

          <dl className="luna-datos">
            <div>
              <dt>Relieve</dt>
              <dd>{decimal(selected.relief)} m</dd>
            </div>
            <div>
              <dt>Pendiente</dt>
              <dd>{decimal(selected.slope, 1)}°</dd>
            </div>
            <div>
              <dt>Rugosidad a 3 km</dt>
              <dd>{decimal(selected.roughness, 1)} m</dd>
            </div>
          </dl>
          <p className="nc-nota">
            {selected.nameEs} · {coordinates(selected.latitude, selected.longitude)} · recuadro de{" "}
            {decimal(selected.sizeKm[0])} × {decimal(selected.sizeKm[1])} km. Valores típicos (mediana) de{" "}
            {selected.windows} ventanas de 3 km, con elevación a {selected.resolutionM} m.
            {selected.measured !== null &&
              ` El ${percent(selected.measured)} de los píxeles tiene medición directa y el resto es interpolado.`}
          </p>
          {fineRoughness[selected.id] && (
            <p className="nc-nota">
              Rugosidad fina, medida por el láser{" "}
              <a href={rugosidad.source.url} target="_blank" rel="noreferrer">
                LOLA
              </a>{" "}
              a escala de 25 m: {decimal(fineRoughness[selected.id]!.median, 2)} m de mediana (la mitad del área entre{" "}
              {decimal(fineRoughness[selected.id]!.q1, 2)} y {decimal(fineRoughness[selected.id]!.q3, 2)} m). En toda la
              Luna es {decimal(rugosidad.moonMedian, 2)} m.
            </p>
          )}
          {moonGroundOf(selected.id) && (
            <p className="nc-nota">
              Temperatura del suelo, medida por el radiómetro{" "}
              <a href={moonGroundSource.url} target="_blank" rel="noreferrer">
                Diviner
              </a>
              : de {decimal(moonGroundOf(selected.id)!.min).replace("-", "−")} °C a{" "}
              {decimal(moonGroundOf(selected.id)!.max).replace("-", "−")} °C a lo largo del día lunar (valor típico de la
              región).
            </p>
          )}
          <p className="nc-nota">
            {zone.origin} Elevación:{" "}
            <a href={zone.source.url} target="_blank" rel="noreferrer">
              {zone.source.name}
            </a>
            . {zone.orientation}
          </p>
          <Candidates regionId={selected.id} regionName={selected.name} />
        </>
      )}
    </section>
  );
}
