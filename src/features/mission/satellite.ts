/**
 * Imagen satelital de un área cuadrada para cubrir el relieve 3D: Sentinel-2 cloudless 2016 de
 * EOX, el mismo mosaico del mapa del lugar. Es una imagen de unos 10 m por píxel: da el color y
 * el contexto del paisaje, no muestra rocas ni detalles a la escala del robot.
 */
import { latToTile, lonToTile, offsetToLatLon } from "./twin";

const TILE_URL = "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg";
const TILE_PX = 256;
const EARTH_CIRCUMFERENCE_M = 40_075_016.686;
/** El mosaico no tiene más detalle que este zoom (unos 10 m por píxel en el ecuador). */
const MAX_ZOOM = 14;
/** Teselas por lado, como mucho: cerca de los polos las teselas cubren poco terreno. */
const MAX_TILES_ACROSS = 9;

export const SATELLITE_CREDIT =
  "Sentinel-2 cloudless 2016 de EOX IT Services GmbH (contiene datos Copernicus Sentinel modificados, 2016), CC BY 4.0";

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    // Sin esto, el lienzo queda «contaminado» y no se puede usar como textura.
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Tesela satelital no disponible"));
    image.src = url;
  });
}

/** El zoom más fino con el que el área cabe en `MAX_TILES_ACROSS` teselas por lado. */
export function satelliteZoom(latitude: number, sizeM: number): number {
  const ground = EARTH_CIRCUMFERENCE_M * Math.cos((latitude * Math.PI) / 180);
  const zoom = Math.floor(Math.log2(((MAX_TILES_ACROSS - 1) * ground) / sizeM));
  return Math.max(0, Math.min(MAX_ZOOM, zoom));
}

/** Lienzo cuadrado con la imagen del área, el norte arriba. Una tesela que falla queda en gris. */
export async function fetchSatellite(latitude: number, longitude: number, sizeM: number, outPx = 2048) {
  const zoom = satelliteZoom(latitude, sizeM);
  const half = sizeM / 2;
  const northWest = offsetToLatLon(latitude, longitude, -half, half);
  const southEast = offsetToLatLon(latitude, longitude, half, -half);
  const px0 = lonToTile(northWest.longitude, zoom) * TILE_PX;
  const py0 = latToTile(northWest.latitude, zoom) * TILE_PX;
  const px1 = lonToTile(southEast.longitude, zoom) * TILE_PX;
  const py1 = latToTile(southEast.latitude, zoom) * TILE_PX;
  const tiles: { x: number; y: number }[] = [];
  for (let x = Math.floor(px0 / TILE_PX); x <= Math.floor(px1 / TILE_PX); x++) {
    for (let y = Math.floor(py0 / TILE_PX); y <= Math.floor(py1 / TILE_PX); y++) tiles.push({ x, y });
  }
  if (tiles.length > 144) throw new Error("El área pide demasiadas teselas satelitales");

  const canvas = document.createElement("canvas");
  canvas.width = outPx;
  canvas.height = outPx;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Este navegador no puede dibujar la imagen satelital");
  context.fillStyle = "#8d8372";
  context.fillRect(0, 0, outPx, outPx);
  const scaleX = outPx / (px1 - px0);
  const scaleY = outPx / (py1 - py0);
  const world = 2 ** zoom;
  const results = await Promise.allSettled(
    tiles.map(async ({ x, y }) => {
      const wrapped = ((x % world) + world) % world;
      const image = await loadImage(TILE_URL.replace("{z}", String(zoom)).replace("{x}", String(wrapped)).replace("{y}", String(y)));
      // Medio píxel de solape: sin él, entre teselas se ve una rendija.
      context.drawImage(image, (x * TILE_PX - px0) * scaleX - 0.5, (y * TILE_PX - py0) * scaleY - 0.5, TILE_PX * scaleX + 1, TILE_PX * scaleY + 1);
    }),
  );
  // Si no llegó casi ninguna, es mejor avisar que mostrar un terreno gris.
  if (results.filter((result) => result.status === "fulfilled").length < tiles.length / 2) {
    throw new Error("La imagen satelital no está disponible");
  }
  return canvas;
}
