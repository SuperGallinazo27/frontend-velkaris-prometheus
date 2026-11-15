/**
 * Minimapa del simulador: el robot visto desde arriba con lo que tiene alrededor. Va con el rumbo
 * del robot hacia arriba: lo que queda arriba en el minimapa es lo que el robot tiene delante.
 *
 * Las funciones de proyección son puras, para poder probarlas; `drawMini` dibuja en un lienzo 2D.
 * Las posiciones van en metros desde el centro del área (este, norte) y el rumbo, en radianes
 * desde el este hacia el norte, como en `drive.ts`.
 */

export interface MiniView {
  /** Dónde está el robot. */
  east: number;
  north: number;
  heading: number;
  /** Metros que se ven a cada lado del robot. */
  rangeM: number;
  /** Lado del minimapa, en píxeles. */
  sizePx: number;
}

export interface MiniPoint {
  x: number;
  y: number;
}

/** El robot queda por debajo del centro: se ve más de lo que tiene delante que de lo que deja atrás. */
export const MINI_ROBOT_Y = 0.66;

/** Alcances entre los que se puede elegir: metros a cada lado del robot. */
export const MINI_RANGES = [40, 150, 600] as const;

/** De metros en el terreno a píxeles del minimapa. */
export function toMini(view: MiniView, east: number, north: number): MiniPoint {
  const scale = view.sizePx / (2 * view.rangeM);
  const de = east - view.east;
  const dn = north - view.north;
  const cos = Math.cos(view.heading);
  const sin = Math.sin(view.heading);
  // Cuánto queda por delante del robot y cuánto a su derecha.
  const along = de * cos + dn * sin;
  const side = de * sin - dn * cos;
  return { x: view.sizePx / 2 + side * scale, y: view.sizePx * MINI_ROBOT_Y - along * scale };
}

/**
 * La barra de escala: la distancia redonda (1, 2 o 5 por una potencia de diez) más larga que ocupa
 * menos de la mitad del ancho.
 */
export function scaleBar(rangeM: number, sizePx: number): { meters: number; px: number } {
  const limit = 2 * rangeM * 0.45;
  const power = 10 ** Math.floor(Math.log10(limit));
  const meters = [5, 2, 1].map((k) => k * power).find((value) => value <= limit) ?? power;
  return { meters, px: (meters * sizePx) / (2 * rangeM) };
}

/**
 * Un punto que cae fuera del minimapa se lleva a su borde, sobre la línea que lo une con el robot:
 * así se sabe hacia dónde queda. `angle` es la dirección hacia el punto, en radianes de pantalla.
 */
export function toEdge(view: MiniView, point: MiniPoint, margin: number): MiniPoint & { outside: boolean; angle: number } {
  const cx = view.sizePx / 2;
  const cy = view.sizePx * MINI_ROBOT_Y;
  const dx = point.x - cx;
  const dy = point.y - cy;
  const low = margin;
  const high = view.sizePx - margin;
  const reach = (from: number, delta: number) => (delta > 0 ? (high - from) / delta : delta < 0 ? (low - from) / delta : Infinity);
  const t = Math.min(1, reach(cx, dx), reach(cy, dy));
  return { x: cx + dx * t, y: cy + dy * t, outside: t < 1, angle: Math.atan2(dy, dx) };
}

export interface MiniData {
  /** Imagen del área entera con el norte arriba (satélite o pendiente), y el lado del área en metros. */
  background: HTMLCanvasElement | null;
  areaM: number;
  /** Camino recorrido: este, norte, este, norte… */
  trail: readonly number[];
  /** Rocas que detienen al robot. */
  rocks: readonly { east: number; north: number; size: number }[];
  /** Módulos de la base que estorban, y su centro. */
  modules: readonly { east: number; north: number; radius: number }[];
  base: { east: number; north: number } | null;
  target: { east: number; north: number } | null;
}

const metersText = (meters: number) => (meters >= 1000 ? `${(meters / 1000).toLocaleString("es", { maximumFractionDigits: 1 })} km` : `${Math.round(meters)} m`);

/** Texto con borde oscuro: se lee sobre cualquier fondo. */
function label(context: CanvasRenderingContext2D, text: string, x: number, y: number, align: CanvasTextAlign = "center") {
  context.textAlign = align;
  context.lineWidth = 3;
  context.strokeStyle = "rgba(6, 14, 12, 0.85)";
  context.strokeText(text, x, y);
  context.fillStyle = "#f3f1e7";
  context.fillText(text, x, y);
}

/** Dibuja el minimapa entero. El lienzo ya debe estar escalado a píxeles de pantalla. */
export function drawMini(context: CanvasRenderingContext2D, view: MiniView, data: MiniData): void {
  const size = view.sizePx;
  const scale = size / (2 * view.rangeM);
  const cx = size / 2;
  const cy = size * MINI_ROBOT_Y;
  context.save();
  context.clearRect(0, 0, size, size);
  context.fillStyle = "#22302b";
  context.fillRect(0, 0, size, size);

  // Fondo: la imagen del área, girada con el robot. Solo se toma el trozo que hace falta.
  const image = data.background;
  if (image && image.width > 0) {
    const perMeter = image.width / data.areaM;
    const reach = view.rangeM * 2.5;
    const half = data.areaM / 2;
    const x0 = Math.max(0, (view.east - reach + half) * perMeter);
    const x1 = Math.min(image.width, (view.east + reach + half) * perMeter);
    const y0 = Math.max(0, (half - view.north - reach) * perMeter);
    const y1 = Math.min(image.height, (half - view.north + reach) * perMeter);
    if (x1 > x0 && y1 > y0) {
      context.save();
      context.translate(cx, cy);
      context.rotate(view.heading - Math.PI / 2);
      context.scale(scale, scale);
      context.imageSmoothingEnabled = true;
      context.drawImage(image, x0, y0, x1 - x0, y1 - y0, x0 / perMeter - half - view.east, y0 / perMeter - half + view.north, (x1 - x0) / perMeter, (y1 - y0) / perMeter);
      context.restore();
      // Un velo oscuro: las marcas se leen mejor.
      context.fillStyle = "rgba(8, 17, 15, 0.3)";
      context.fillRect(0, 0, size, size);
    }
  }

  // Camino recorrido.
  if (data.trail.length >= 4) {
    context.beginPath();
    for (let i = 0; i < data.trail.length; i += 2) {
      const point = toMini(view, data.trail[i], data.trail[i + 1]);
      if (i === 0) context.moveTo(point.x, point.y);
      else context.lineTo(point.x, point.y);
    }
    context.lineTo(cx, cy);
    context.lineJoin = "round";
    context.lineCap = "round";
    context.lineWidth = 4;
    context.strokeStyle = "rgba(6, 14, 12, 0.55)";
    context.stroke();
    context.lineWidth = 2;
    context.strokeStyle = "#ffd166";
    context.stroke();
  }

  // Rocas que detienen al robot.
  context.fillStyle = "#4a463f";
  context.strokeStyle = "rgba(255, 255, 255, 0.8)";
  context.lineWidth = 0.9;
  for (const rock of data.rocks) {
    const point = toMini(view, rock.east, rock.north);
    const radius = Math.max(1.7, (rock.size / 2) * scale);
    if (point.x < -radius || point.x > size + radius || point.y < -radius || point.y > size + radius) continue;
    context.beginPath();
    context.arc(point.x, point.y, radius, 0, Math.PI * 2);
    context.fill();
    context.stroke();
  }

  // Base: cada módulo, y su nombre.
  context.font = "600 10px system-ui, sans-serif";
  context.textBaseline = "alphabetic";
  context.fillStyle = "#f4efe2";
  context.strokeStyle = "rgba(6, 14, 12, 0.9)";
  context.lineWidth = 1;
  for (const part of data.modules) {
    const point = toMini(view, part.east, part.north);
    const half = Math.max(2.2, part.radius * scale * 0.8);
    context.beginPath();
    context.rect(point.x - half, point.y - half, half * 2, half * 2);
    context.fill();
    context.stroke();
  }
  if (data.base) {
    const point = toMini(view, data.base.east, data.base.north);
    const top = Math.max(12, 9 * scale + 8);
    if (point.x > 14 && point.x < size - 14 && point.y > top + 6 && point.y < size) label(context, "Base", point.x, point.y - top);
  }

  // Destino: la bandera o, si queda fuera, una flecha en el borde con la distancia.
  if (data.target) {
    const spot = toEdge(view, toMini(view, data.target.east, data.target.north), 13);
    context.save();
    context.translate(spot.x, spot.y);
    if (spot.outside) {
      context.rotate(spot.angle);
      context.beginPath();
      context.moveTo(9, 0);
      context.lineTo(-5, -6.5);
      context.lineTo(-2, 0);
      context.lineTo(-5, 6.5);
      context.closePath();
    } else {
      context.beginPath();
      context.moveTo(0, 3);
      context.lineTo(0, -10);
      context.lineTo(9, -6.5);
      context.lineTo(1.6, -3);
      context.lineTo(1.6, 3);
      context.closePath();
    }
    context.fillStyle = "#ff6b4a";
    context.strokeStyle = "#ffffff";
    context.lineWidth = 1.2;
    context.fill();
    context.stroke();
    context.restore();
    if (spot.outside) {
      const away = Math.hypot(data.target.east - view.east, data.target.north - view.north);
      const inward = 15;
      const tx = Math.min(size - 20, Math.max(20, spot.x - Math.cos(spot.angle) * inward));
      const ty = Math.min(size - 8, Math.max(14, spot.y - Math.sin(spot.angle) * inward + 3));
      label(context, metersText(away), tx, ty);
    }
  }

  // El robot: una flecha que siempre apunta hacia arriba.
  context.beginPath();
  context.moveTo(cx, cy - 10);
  context.lineTo(cx + 7, cy + 7);
  context.lineTo(cx, cy + 3);
  context.lineTo(cx - 7, cy + 7);
  context.closePath();
  context.fillStyle = "#ffd166";
  context.strokeStyle = "#14201c";
  context.lineWidth = 1.6;
  context.fill();
  context.stroke();

  // Dónde queda el norte: sobre un anillo que no pisa la barra de escala ni los botones.
  const ring = size * 0.36;
  const nx = size / 2 - Math.cos(view.heading) * ring;
  const ny = size / 2 - Math.sin(view.heading) * ring;
  context.beginPath();
  context.arc(nx, ny, 8, 0, Math.PI * 2);
  context.fillStyle = "rgba(8, 17, 15, 0.8)";
  context.fill();
  context.font = "700 10px system-ui, sans-serif";
  context.textAlign = "center";
  context.fillStyle = "#ff9d7a";
  context.fillText("N", nx, ny + 3.5);

  // Barra de escala.
  const bar = scaleBar(view.rangeM, size);
  const bx = 9;
  const by = size - 9;
  context.beginPath();
  context.moveTo(bx, by - 4);
  context.lineTo(bx, by);
  context.lineTo(bx + bar.px, by);
  context.lineTo(bx + bar.px, by - 4);
  context.lineWidth = 3.4;
  context.strokeStyle = "rgba(6, 14, 12, 0.85)";
  context.stroke();
  context.lineWidth = 1.6;
  context.strokeStyle = "#f3f1e7";
  context.stroke();
  context.font = "600 10px system-ui, sans-serif";
  label(context, metersText(bar.meters), bx + bar.px + 5, by, "left");
  context.restore();
}
