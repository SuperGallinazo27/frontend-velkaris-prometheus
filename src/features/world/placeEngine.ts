/**
 * Mapa de un lugar: imagen satelital sobre relieve real en 3D.
 *
 * Todo es gratuito y sin clave; solo se envían las coordenadas de las teselas que se ven.
 * - Mapa: MapLibre GL JS (código abierto).
 * - Satélite: Sentinel-2 cloudless 2016 de EOX (CC BY 4.0), 10 m por píxel.
 * - Callejero: OpenStreetMap.
 * - Hoy desde el espacio: imagen diaria MODIS/Terra de NASA GIBS, 250 m por píxel.
 * - Relieve 3D: teselas Terrarium de Mapzen, alojadas en AWS Open Data.
 */
import { Map as MapLibreMap, Marker, setWorkerUrl } from "maplibre-gl";
import type { LngLatBoundsLike, PaddingOptions, StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";

setWorkerUrl(workerUrl);

export type Base = "satelite" | "callejero" | "hoy";

export interface BaseInfo {
  id: Base;
  name: string;
  /** Crédito obligatorio de la capa. */
  credit: string;
  creditUrl: string;
}

export const BASES: BaseInfo[] = [
  {
    id: "satelite",
    name: "Satélite",
    credit: "Sentinel-2 cloudless, s2maps.eu, de EOX IT Services GmbH (contiene datos Copernicus Sentinel modificados, 2016 y 2017)",
    creditUrl: "https://s2maps.eu",
  },
  {
    id: "callejero",
    name: "Mapa",
    credit: "© colaboradores de OpenStreetMap",
    creditUrl: "https://www.openstreetmap.org/copyright",
  },
  {
    id: "hoy",
    name: "Hoy desde el espacio",
    credit: "NASA EOSDIS GIBS, imagen diaria MODIS/Terra",
    creditUrl: "https://www.earthdata.nasa.gov/engage/open-data-services-software/earthdata-developer-portal/gibs-api",
  },
];

export const TERRAIN_CREDIT = {
  credit: "Relieve: teselas Terrarium de Mapzen (AWS Open Data)",
  creditUrl: "https://registry.opendata.aws/terrain-tiles/",
};

/** El mosaico Sentinel-2 no cubre la Antártida: allí se parte de la imagen diaria de la NASA. */
export const SATELLITE_SOUTH_LIMIT = -60;

/** Cuánto se exagera el relieve para que se lea a esta escala. Se muestra en pantalla. */
export const EXAGGERATION = 1.5;

const TILT = 58;
/** La imagen diaria tiene 250 m por píxel: se ve de lejos, con contexto regional. */
const REGIONAL_HALF_M = 110_000;

/** Fecha de la imagen diaria: anteayer en UTC, para que ya esté publicada en todo el mundo. */
export function dailyImageDate(now = new Date()): string {
  return new Date(now.getTime() - 2 * 24 * 3600 * 1000).toISOString().slice(0, 10);
}

/** Esquinas de un cuadrado de `halfM` metros de semilado alrededor de un punto: [oeste, sur, este, norte]. */
export function squareBounds(latitude: number, longitude: number, halfM: number): [number, number, number, number] {
  const dLat = halfM / 111_320;
  const dLon = halfM / (111_320 * Math.cos((latitude * Math.PI) / 180));
  return [longitude - dLon, latitude - dLat, longitude + dLon, latitude + dLat];
}

function styleFor(latitude: number, longitude: number, halfM: number, base: Base, date: string): StyleSpecification {
  const [west, south, east, north] = squareBounds(latitude, longitude, halfM);
  const visible = (id: Base) => ({ visibility: id === base ? ("visible" as const) : ("none" as const) });
  return {
    version: 8,
    sources: {
      satelite: {
        type: "raster",
        tiles: ["https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg"],
        tileSize: 256,
        maxzoom: 14,
      },
      callejero: {
        type: "raster",
        tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
        tileSize: 256,
        maxzoom: 19,
      },
      hoy: {
        type: "raster",
        tiles: [
          `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_CorrectedReflectance_TrueColor/default/${date}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`,
        ],
        tileSize: 256,
        maxzoom: 9,
      },
      relieve: {
        type: "raster-dem",
        tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
        tileSize: 256,
        maxzoom: 13,
        encoding: "terrarium",
      },
      area: {
        type: "geojson",
        data: {
          type: "Feature",
          properties: {},
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [west, south],
                [east, south],
                [east, north],
                [west, north],
                [west, south],
              ],
            ],
          },
        },
      },
    },
    layers: [
      { id: "fondo", type: "background", paint: { "background-color": "#070f0d" } },
      { id: "satelite", type: "raster", source: "satelite", layout: visible("satelite") },
      { id: "callejero", type: "raster", source: "callejero", layout: visible("callejero") },
      { id: "hoy", type: "raster", source: "hoy", layout: visible("hoy") },
      {
        id: "area-sombra",
        type: "line",
        source: "area",
        paint: { "line-color": "#000000", "line-width": 5, "line-opacity": 0.45 },
      },
      { id: "area-borde", type: "line", source: "area", paint: { "line-color": "#ffd84a", "line-width": 2.5 } },
    ],
    sky: {
      "sky-color": "#0c2230",
      "horizon-color": "#3b5560",
      "fog-color": "#0c1614",
      "sky-horizon-blend": 0.7,
      "horizon-fog-blend": 0.7,
      "fog-ground-blend": 0.35,
    },
  };
}

export interface PlaceMapOptions {
  container: HTMLElement;
  latitude: number;
  longitude: number;
  /** Semilado, en metros, del área analizada que se dibuja como recuadro. */
  halfM: number;
  name: string;
  base: Base;
  /** Espacio que tapan los paneles: el lugar se centra en lo que queda libre. */
  padding: PaddingOptions;
  /** Sin animaciones (movimiento reducido). */
  calm: boolean;
  onReady: () => void;
  onError: () => void;
}

export interface PlaceMapHandle {
  setBase(base: Base): void;
  setTilt(tilted: boolean): void;
  setPadding(padding: PaddingOptions): void;
  /** Multiplica la distancia: menor que 1 acerca. */
  zoomBy(factor: number): void;
  dispose(): void;
}

export function createPlaceMap(options: PlaceMapOptions): PlaceMapHandle {
  const { container, latitude, longitude, halfM, calm } = options;
  const placeBounds = squareBounds(latitude, longitude, halfM * 1.25) as LngLatBoundsLike;
  const regionBounds = squareBounds(latitude, longitude, REGIONAL_HALF_M) as LngLatBoundsLike;
  let base = options.base;
  let tilted = true;
  let padding = options.padding;
  let orbiting = false;
  let frame = 0;
  let disposed = false;

  const boundsOf = (which: Base) => (which === "hoy" ? regionBounds : placeBounds);

  let map: MapLibreMap;
  try {
    map = new MapLibreMap({
      container,
      style: styleFor(latitude, longitude, halfM, base, dailyImageDate()),
      bounds: boundsOf(base),
      fitBoundsOptions: { padding },
      maxPitch: 75,
      // Los créditos de cada capa los muestra la pantalla, junto a la leyenda.
      attributionControl: false,
    });
  } catch {
    // Sin WebGL no hay mapa: se avisa y se devuelve un control que no hace nada.
    queueMicrotask(options.onError);
    return { setBase() {}, setTilt() {}, setPadding() {}, zoomBy() {}, dispose() {} };
  }

  // Solo en desarrollo: deja el mapa a mano para inspeccionarlo desde la consola.
  if (import.meta.env.DEV) Object.assign(container, { __map: map });

  const dot = document.createElement("div");
  dot.className = "lugar-marca";
  const label = document.createElement("span");
  label.textContent = options.name;
  dot.append(label);
  new Marker({ element: dot, anchor: "center" }).setLngLat([longitude, latitude]).addTo(map);

  const stopOrbit = () => {
    orbiting = false;
    cancelAnimationFrame(frame);
  };
  const startOrbit = () => {
    if (calm || disposed || orbiting || !tilted) return;
    orbiting = true;
    let last = performance.now();
    const step = (now: number) => {
      if (!orbiting) return;
      // Una vuelta completa cada dos minutos: se nota el relieve sin marear.
      map.setBearing(map.getBearing() + ((now - last) / 1000) * 3);
      last = now;
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
  };
  for (const type of ["pointerdown", "wheel", "keydown", "touchstart"] as const) {
    container.addEventListener(type, stopOrbit, { passive: true });
  }

  /**
   * Encuadra el lugar (o la región, con la imagen diaria). El margen de los paneles ya está puesto
   * en el mapa con `setPadding`: si se pasara otra vez aquí, se sumaría dos veces.
   */
  const view = (which: Base, animate: boolean, eventData?: Record<string, unknown>) => {
    const pitch = tilted ? (which === "hoy" ? 35 : TILT) : 0;
    const bearing = tilted ? -24 : 0;
    const camera = map.cameraForBounds(boundsOf(which), { bearing });
    if (!camera) return;
    const target = { center: camera.center, zoom: camera.zoom, bearing, pitch };
    if (animate && !calm) map.easeTo({ ...target, duration: 2400 }, eventData);
    else map.jumpTo(target, eventData);
  };

  let failed = false;
  const fail = () => {
    if (failed || disposed) return;
    failed = true;
    options.onError();
  };
  // Sin WebGL, MapLibre lo notifica con un evento de error antes de cargar el estilo.
  map.on("error", (event) => {
    if (!map.isStyleLoaded() && /webgl/i.test(String(event.error?.message ?? ""))) fail();
  });

  map.once("load", () => {
    if (disposed) return;
    map.setTerrain({ source: "relieve", exaggeration: EXAGGERATION });
    map.setPadding(padding);
    options.onReady();
    // El giro empieza cuando termina la entrada, y no antes: girar corta cualquier animación en curso.
    const afterIntro = (event: object) => {
      if (!(event as { intro?: boolean }).intro) return;
      map.off("moveend", afterIntro);
      startOrbit();
    };
    map.on("moveend", afterIntro);
    view(base, true, { intro: true });
  });

  return {
    setBase(next) {
      if (next === base) return;
      for (const info of BASES) {
        map.setLayoutProperty(info.id, "visibility", info.id === next ? "visible" : "none");
      }
      const reframe = (next === "hoy") !== (base === "hoy");
      base = next;
      if (reframe) {
        stopOrbit();
        view(base, true);
      }
    },
    setTilt(next) {
      if (next === tilted) return;
      tilted = next;
      stopOrbit();
      map.setTerrain(tilted ? { source: "relieve", exaggeration: EXAGGERATION } : null);
      view(base, true);
    },
    setPadding(next) {
      const changed = (["top", "right", "bottom", "left"] as const).some((side) => next[side] !== padding[side]);
      padding = next;
      // Antes de cargar, el margen se aplica al terminar la carga.
      if (changed && map.loaded()) map.easeTo({ padding, duration: calm ? 0 : 600 });
    },
    zoomBy(factor) {
      stopOrbit();
      map.easeTo({ zoom: map.getZoom() - Math.log2(factor), duration: calm ? 0 : 350 });
    },
    dispose() {
      disposed = true;
      stopOrbit();
      for (const type of ["pointerdown", "wheel", "keydown", "touchstart"] as const) {
        container.removeEventListener(type, stopOrbit);
      }
      map.remove();
    },
  };
}
