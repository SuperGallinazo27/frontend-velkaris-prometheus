/**
 * La base de campaña, las rocas y las matas del campo de práctica, en 3D.
 *
 * - La base es de ejemplo: una estación de campo con su módulo, carpa, paneles, antena y depósito.
 * - Cuántas rocas y matas hay sale de la lectura de fotos cuando existe (`camp.ts`); su forma, su
 *   textura y el sitio de cada una son ilustrativos.
 * - Bajo cada roca y cada módulo va una sombra de contacto: con el cielo cubierto el Sol no da
 *   sombra y, sin ella, las cosas parecen flotar.
 */
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  InstancedMesh,
  LatheGeometry,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  PointLight,
  Quaternion,
  RepeatWrapping,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
  Vector2,
  Vector3,
} from "three";
import type { BufferGeometry as Geometry, Material, Texture } from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import type { Surface } from "../world/terrainReading";
import { ROCK_VARIANTS } from "./camp";
import type { CampItem, CampLayout } from "./camp";
import type { HeightAt } from "./drive";
import { GROUND_TEXTURES } from "./groundTextures";
import { bake, disposeTree, lattice, rockGeometry, solarTexture, strut } from "./robotModels";

type RGB = readonly [number, number, number];

export interface CampLook {
  /** Color del suelo alrededor del campo según el satélite (sRGB, 0 a 1). */
  tint: RGB;
  /** Qué cubre el suelo: da el tono de las rocas. */
  surface: Surface;
  /** Fotografía de roca (color y relieve fino) para las rocas; null mientras carga. */
  rock: { color: Texture; normal: Texture } | null;
}

export interface CampMeshes {
  /** Módulos de la base, con sus sombras de contacto. */
  base: Group;
  /** Rocas y piedras, con sus sombras de contacto. */
  rocks: Group;
  /** Matas de vegetación baja. */
  tufts: Group;
  /** De noche (1) se encienden las luces de la base; de día (0), no. `overcast` refuerza las sombras de contacto. */
  setLight(night: number, overcast: number): void;
  /** Vaivén de las matas con el viento y parpadeo de la baliza. */
  update(time: number, windSpeed: number): void;
  dispose(): void;
}

/**
 * Cuánto más clara (más de 1) u oscura (menos de 1) que el suelo es la roca suelta de cada
 * superficie: sobre nieve o sal las piedras se ven oscuras; entre la hierba, claras.
 */
const ROCK_LEVEL: Record<Surface, number> = {
  lava: 0.8,
  ceniza: 0.95,
  arena: 0.85,
  grava: 1.05,
  roca: 1.1,
  suelo: 0.95,
  sal: 0.6,
  nieve: 0.38,
  vegetacion: 1.25,
};
/** Parte del color del suelo que toma la roca; el resto es gris. */
const ROCK_HUE = 0.5;

const luminance = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

function part(group: Group, geometry: Geometry, material: Material | Material[], x: number, y: number, z: number, rotation?: [number, number, number]) {
  const mesh = new Mesh(geometry, material);
  mesh.position.set(x, y, z);
  if (rotation) mesh.rotation.set(...rotation);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

/** Chapa de los módulos: franjas de paneles con juntas, y polvo en la parte baja. */
function shellTexture(): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 256;
  const context = canvas.getContext("2d")!;
  context.fillStyle = "#eceef0";
  context.fillRect(0, 0, 512, 256);
  const grain = lattice(512, 40, 23);
  const image = context.getImageData(0, 0, 512, 256);
  for (let y = 0; y < 256; y++) {
    for (let x = 0; x < 512; x++) {
      const o = (y * 512 + x) * 4;
      const shade = 1 - 0.07 * grain(x, y * 2);
      for (let k = 0; k < 3; k++) image.data[o + k] *= shade;
    }
  }
  context.putImageData(image, 0, 0);
  context.strokeStyle = "rgba(70,76,86,0.5)";
  context.lineWidth = 2;
  for (let x = 0; x <= 512; x += 64) {
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, 256);
    context.stroke();
  }
  for (const y of [64, 128, 192]) {
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(512, y);
    context.stroke();
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.anisotropy = 8;
  return texture;
}

/** Mancha redonda que se apaga hacia el borde: la sombra de contacto bajo una roca o un módulo. */
function blobTexture(): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext("2d")!;
  const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.45, "rgba(255,255,255,0.75)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 64, 64);
  return new CanvasTexture(canvas);
}

/** Una mata de hierba dibujada: hojas finas que salen del suelo, sobre fondo transparente. */
function tuftTexture(): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext("2d")!;
  let state = 77;
  const random = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
  for (let k = 0; k < 46; k++) {
    const x0 = 64 + (random() - 0.5) * 44;
    const lean = (random() - 0.5) * 78;
    const tall = 58 + random() * 66;
    const blade = context.createLinearGradient(0, 128, 0, 128 - tall);
    const tone = 150 + Math.floor(random() * 80);
    blade.addColorStop(0, `rgb(${tone - 70},${tone - 60},${tone - 100})`);
    blade.addColorStop(1, `rgb(${tone + 20},${tone + 14},${tone - 30})`);
    context.strokeStyle = blade;
    context.lineWidth = 1.6 + random() * 2.2;
    context.lineCap = "round";
    context.beginPath();
    context.moveTo(x0, 128);
    context.quadraticCurveTo(x0 + lean * 0.2, 128 - tall * 0.6, x0 + lean, 128 - tall);
    context.stroke();
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/** Tres láminas cruzadas, con la base en el suelo y las normales hacia arriba para que reciban la luz como el suelo. */
function tuftGeometry(): BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const normals: number[] = [];
  for (let k = 0; k < 3; k++) {
    const angle = (k / 3) * Math.PI;
    const cx = Math.cos(angle) * 0.5;
    const cz = Math.sin(angle) * 0.5;
    const quad = [
      [-cx, 0, -cz, 0, 0],
      [cx, 0, cz, 1, 0],
      [cx, 1, cz, 1, 1],
      [-cx, 0, -cz, 0, 0],
      [cx, 1, cz, 1, 1],
      [-cx, 1, -cz, 0, 1],
    ];
    for (const [x, y, z, u, v] of quad) {
      positions.push(x, y, z);
      uvs.push(u, v);
      normals.push(0, 1, 0);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute("normal", new BufferAttribute(new Float32Array(normals), 3));
  geometry.setAttribute("uv", new BufferAttribute(new Float32Array(uvs), 2));
  return geometry;
}

interface BaseKit {
  shell: MeshStandardMaterial;
  white: MeshStandardMaterial;
  grey: MeshStandardMaterial;
  steel: MeshStandardMaterial;
  dark: MeshStandardMaterial;
  orange: MeshStandardMaterial;
  yellow: MeshStandardMaterial;
  tank: MeshStandardMaterial;
  fabric: MeshStandardMaterial;
  wood: MeshStandardMaterial;
  panel: MeshPhysicalMaterial;
  glass: MeshStandardMaterial;
  lamp: MeshStandardMaterial;
  beacon: MeshStandardMaterial;
  rope: MeshStandardMaterial;
  dish: MeshStandardMaterial;
}

/** Un módulo de la base, con el suelo en y = 0 y su frente hacia +x. */
function buildItem(kind: CampItem["kind"], kit: BaseKit): Group {
  const group = new Group();
  const { shell, white, grey, steel, dark, orange, yellow, tank, fabric, wood, panel, glass, lamp, beacon, rope } = kit;
  if (kind === "habitat") {
    // Módulo habitable: cilindro tumbado de 5 m sobre patines, con esclusa, escalera y barandillas.
    const radius = 1.35;
    const length = 5;
    const y = radius + 0.5;
    part(group, new CylinderGeometry(radius, radius, length, 36), shell, 0, y, 0, [0, 0, Math.PI / 2]);
    for (const side of [1, -1]) part(group, new SphereGeometry(radius, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), white, (side * length) / 2, y, 0, [0, 0, (-side * Math.PI) / 2]).scale.set(1, 0.42, 1);
    for (const x of [-1.7, 0, 1.7]) part(group, new TorusGeometry(radius + 0.012, 0.045, 8, 40), orange, x, y, 0, [0, Math.PI / 2, 0]);
    // Patines y cunas.
    for (const side of [1, -1]) {
      part(group, new RoundedBoxGeometry(length + 0.6, 0.16, 0.22, 2, 0.04), grey, 0, 0.08, side * 0.85);
      for (const x of [-1.9, 0, 1.9]) part(group, new BoxGeometry(0.16, y - radius * 0.72, 0.16), grey, x, (y - radius * 0.72) / 2 + 0.1, side * 0.85);
    }
    for (const x of [-1.9, 0, 1.9]) part(group, new BoxGeometry(0.12, 0.12, 1.9), grey, x, 0.46, 0);
    // Ventanas redondas con marco, a los dos lados.
    for (const x of [-1.2, 1.2]) {
      for (const side of [1, -1]) {
        part(group, new TorusGeometry(0.36, 0.05, 8, 24), grey, x, y + 0.22, side * (radius - 0.01));
        part(group, new CylinderGeometry(0.34, 0.34, 0.03, 24), glass, x, y + 0.22, side * (radius - 0.03), [Math.PI / 2, 0, 0]);
      }
    }
    // Esclusa al frente: marco, puerta con ventanilla, luz y plataforma con escalera y barandillas.
    const front = length / 2;
    part(group, new RoundedBoxGeometry(1.5, 2.15, 1.7, 3, 0.06), white, front + 0.85, 1.42, 0);
    part(group, new RoundedBoxGeometry(0.08, 1.75, 0.95, 2, 0.02), dark, front + 1.61, 1.32, 0);
    part(group, new RoundedBoxGeometry(0.05, 0.36, 0.36, 2, 0.02), glass, front + 1.64, 1.72, 0);
    part(group, new CylinderGeometry(0.02, 0.02, 0.22, 8), steel, front + 1.67, 1.3, 0.34);
    part(group, new RoundedBoxGeometry(0.1, 0.1, 0.3, 2, 0.02), lamp, front + 1.62, 2.38, 0);
    part(group, new BoxGeometry(1.1, 0.06, 1.7), grey, front + 2.15, 0.44, 0);
    for (let step = 0; step < 2; step++) part(group, new BoxGeometry(0.3, 0.05, 1.3), grey, front + 2.85 + step * 0.3, 0.3 - step * 0.15, 0);
    for (const side of [1, -1]) {
      const rail = new Vector3(front + 1.65, 1.4, side * 0.83);
      strut(group, steel, rail, new Vector3(front + 2.7, 1.4, side * 0.83), 0.035);
      strut(group, steel, new Vector3(front + 2.7, 1.4, side * 0.83), new Vector3(front + 3.25, 0.95, side * 0.66), 0.035);
      for (const x of [front + 2.15, front + 2.7]) strut(group, steel, new Vector3(x, 0.46, side * 0.83), new Vector3(x, 1.4, side * 0.83), 0.03);
      strut(group, steel, new Vector3(front + 3.25, 0.1, side * 0.66), new Vector3(front + 3.25, 0.95, side * 0.66), 0.03);
    }
    // En el techo: climatización, una escotilla y un tubo de ventilación.
    part(group, new RoundedBoxGeometry(0.9, 0.34, 0.7, 2, 0.04), grey, -1.1, y + radius + 0.1, 0);
    part(group, new CylinderGeometry(0.26, 0.26, 0.05, 20), dark, -1.1, y + radius + 0.29, 0);
    part(group, new CylinderGeometry(0.3, 0.3, 0.12, 20), white, 0.9, y + radius - 0.02, 0);
    part(group, new CylinderGeometry(0.06, 0.06, 0.6, 10), steel, 1.9, y + radius + 0.2, 0.4);
    // Cable hasta los paneles.
    strut(group, rope, new Vector3(-0.4, 0.04, 0.9), new Vector3(1.2, 0.04, 5.6), 0.05);
  } else if (kind === "domo") {
    // Carpa de trabajo: una cúpula de paños sobre arcos, con túnel de entrada y vientos al suelo.
    part(group, new SphereGeometry(2.2, 20, 9, 0, Math.PI * 2, 0, Math.PI / 2), fabric, 0, 0, 0);
    for (let k = 0; k < 5; k++) part(group, new TorusGeometry(2.22, 0.028, 6, 28, Math.PI), grey, 0, 0, 0, [0, (k / 5) * Math.PI, 0]);
    part(group, new TorusGeometry(2.21, 0.05, 6, 36), grey, 0, 0.04, 0, [Math.PI / 2, 0, 0]);
    part(group, new CylinderGeometry(0.95, 0.95, 1.3, 20, 1, false, 0, Math.PI), fabric, 2.2, 0, 0, [0, 0, Math.PI / 2]);
    part(group, new BoxGeometry(0.04, 1.5, 0.95), dark, 2.86, 0.76, 0);
    part(group, new BoxGeometry(0.03, 0.5, 0.5), glass, -0.6, 1.5, 1.72, [0.6, 0.3, 0]);
    for (let k = 0; k < 6; k++) {
      const angle = (k / 6) * Math.PI * 2 + 0.5;
      const from = new Vector3(Math.cos(angle) * 1.9, 1.15, Math.sin(angle) * 1.9);
      const to = new Vector3(Math.cos(angle) * 3.2, 0.03, Math.sin(angle) * 3.2);
      strut(group, rope, from, to, 0.016);
      part(group, new CylinderGeometry(0.02, 0.012, 0.22, 6), steel, to.x, 0.08, to.z);
    }
  } else if (kind === "paneles") {
    // Campo solar: tres paneles inclinados sobre bastidores con tirantes, un inversor y su cable.
    for (const z of [-1.7, 0, 1.7]) {
      const board = part(group, new BoxGeometry(1.3, 0.05, 1.56), [steel, steel, panel, steel, steel, steel], 0, 1.02, z, [0, 0, 0.5]);
      board.castShadow = true;
      for (const edge of [0.78, -0.78]) part(group, new BoxGeometry(1.34, 0.07, 0.05), grey, 0, 1.02, z + edge, [0, 0, 0.5]);
      for (const x of [-0.45, 0.45]) {
        const tall = 1 + x * 0.56;
        part(group, new BoxGeometry(0.06, tall, 0.06), grey, x, tall / 2, z - 0.55);
        part(group, new BoxGeometry(0.06, tall, 0.06), grey, x, tall / 2, z + 0.55);
        part(group, new BoxGeometry(0.2, 0.04, 0.2), grey, x, 0.02, z - 0.55);
        part(group, new BoxGeometry(0.2, 0.04, 0.2), grey, x, 0.02, z + 0.55);
      }
      strut(group, steel, new Vector3(-0.45, 0.1, z - 0.55), new Vector3(0.45, 1.2, z - 0.55), 0.03);
      strut(group, steel, new Vector3(-0.45, 0.1, z + 0.55), new Vector3(0.45, 1.2, z + 0.55), 0.03);
    }
    part(group, new RoundedBoxGeometry(0.55, 0.6, 0.8, 2, 0.04), grey, -1.2, 0.34, 0);
    part(group, new BoxGeometry(0.02, 0.2, 0.3), dark, -1.48, 0.42, 0);
    strut(group, rope, new Vector3(-1.2, 0.04, -2.2), new Vector3(-1.2, 0.04, 2.2), 0.04);
  } else if (kind === "antena") {
    // Mástil de celosía con parábola, baliza y vientos.
    const tall = 6.2;
    const legs = [
      [0.17, 0.17],
      [-0.17, 0.17],
      [0.17, -0.17],
      [-0.17, -0.17],
    ] as const;
    for (const [x, z] of legs) part(group, new CylinderGeometry(0.024, 0.024, tall, 8), grey, x, tall / 2, z);
    for (let y = 0.5; y < tall; y += 0.8) {
      for (const [x, z] of legs) {
        strut(group, grey, new Vector3(x, y, z), new Vector3(-z, y + 0.8 > tall ? tall : y + 0.8, x), 0.014);
      }
      part(group, new BoxGeometry(0.36, 0.02, 0.36), grey, 0, y, 0);
    }
    const profile = Array.from({ length: 9 }, (_, k) => new Vector2((k / 8) * 0.62, ((k / 8) ** 2) * 0.2));
    part(group, new LatheGeometry(profile, 30), kit.dish, 0.24, 5.15, 0, [0, 0, -Math.PI / 2 + 0.3]);
    part(group, new CylinderGeometry(0.012, 0.012, 0.5, 6), steel, 0.55, 5.27, 0, [0, 0, -Math.PI / 2 + 0.3]);
    part(group, new CylinderGeometry(0.05, 0.03, 0.08, 10), dark, 0.78, 5.34, 0, [0, 0, -Math.PI / 2 + 0.3]);
    part(group, new CylinderGeometry(0.014, 0.014, 0.9, 6), steel, 0, tall + 0.45, 0);
    part(group, new SphereGeometry(0.08, 12, 10), beacon, 0, tall + 0.06, 0);
    part(group, new RoundedBoxGeometry(0.8, 0.5, 0.8, 2, 0.04), grey, 0, 0.25, 0);
    for (let k = 0; k < 3; k++) {
      const angle = (k / 3) * Math.PI * 2 + 0.4;
      const to = new Vector3(Math.cos(angle) * 3.4, 0.03, Math.sin(angle) * 3.4);
      strut(group, rope, new Vector3(0, tall * 0.72, 0), to, 0.014);
      part(group, new CylinderGeometry(0.03, 0.02, 0.24, 6), steel, to.x, 0.09, to.z);
    }
  } else if (kind === "deposito") {
    // Depósito sobre patines, con sus tapas y su boca, y un generador con el escape.
    part(group, new CylinderGeometry(0.6, 0.6, 1.5, 28), tank, 0, 0.9, 0, [0, 0, Math.PI / 2]);
    for (const side of [1, -1]) part(group, new SphereGeometry(0.6, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), tank, side * 0.75, 0.9, 0, [0, 0, (-side * Math.PI) / 2]).scale.set(1, 0.5, 1);
    for (const x of [-0.5, 0.5]) part(group, new TorusGeometry(0.61, 0.025, 6, 28), dark, x, 0.9, 0, [0, Math.PI / 2, 0]);
    part(group, new CylinderGeometry(0.1, 0.1, 0.14, 14), dark, 0.2, 1.54, 0);
    for (const x of [-0.6, 0.6]) part(group, new RoundedBoxGeometry(0.14, 0.3, 1.15, 2, 0.03), grey, x, 0.15, 0);
    part(group, new RoundedBoxGeometry(0.9, 0.72, 0.62, 2, 0.04), dark, 0, 0.42, 1.3);
    part(group, new BoxGeometry(0.4, 0.3, 0.02), grey, 0, 0.5, 1.62);
    part(group, new CylinderGeometry(0.035, 0.035, 0.5, 8), steel, 0.3, 1.0, 1.2);
    for (const x of [-0.33, 0.33]) part(group, new CylinderGeometry(0.12, 0.12, 0.08, 14), dark, x, 0.12, 1.3, [Math.PI / 2, 0, 0]);
  } else if (kind === "cajas") {
    // Cajas de equipo con herrajes, bidones y una mesa de trabajo.
    const crate = (x: number, y: number, z: number, size: [number, number, number], material: Material, turn: number) => {
      const box = part(group, new RoundedBoxGeometry(size[0], size[1], size[2], 2, 0.025), material, x, y, z, [0, turn, 0]);
      for (const edge of [size[1] / 2 - 0.05, -size[1] / 2 + 0.05]) {
        const band = new Mesh(new BoxGeometry(size[0] + 0.012, 0.04, size[2] + 0.012), steel);
        band.position.y = edge;
        box.add(band);
      }
      return box;
    };
    crate(0, 0.36, 0, [1.1, 0.7, 0.8], wood, 0);
    crate(0.1, 0.99, 0.05, [0.8, 0.55, 0.6], grey, 0.3);
    crate(-0.2, 0.26, 1.0, [0.7, 0.5, 0.7], orange, -0.2);
    crate(1.0, 0.21, 0.5, [0.5, 0.4, 0.5], wood, 0.5);
    for (const [x, z] of [
      [-0.9, -0.5],
      [-1.15, -0.2],
    ] as const) {
      part(group, new CylinderGeometry(0.2, 0.2, 0.55, 18), yellow, x, 0.28, z);
      part(group, new TorusGeometry(0.2, 0.012, 6, 18), dark, x, 0.42, z, [Math.PI / 2, 0, 0]);
    }
    part(group, new BoxGeometry(1.2, 0.04, 0.6), wood, 0.6, 0.74, -0.9);
    for (const x of [0.06, 1.14]) for (const z of [-1.16, -0.64]) part(group, new CylinderGeometry(0.02, 0.02, 0.72, 6), steel, x, 0.36, z);
    part(group, new RoundedBoxGeometry(0.34, 0.03, 0.24, 2, 0.01), dark, 0.5, 0.78, -0.9);
    part(group, new BoxGeometry(0.34, 0.22, 0.02), dark, 0.5, 0.89, -1.02, [-0.25, 0, 0]);
  } else {
    // Banderín de la base, sin emblemas, ondeando.
    part(group, new CylinderGeometry(0.03, 0.035, 3.4, 10), steel, 0, 1.7, 0);
    part(group, new SphereGeometry(0.05, 10, 8), steel, 0, 3.42, 0);
    const cloth = new PlaneGeometry(1.0, 0.56, 12, 4);
    const position = cloth.getAttribute("position");
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i) + 0.5;
      position.setZ(i, Math.sin(x * 7) * 0.06 * x);
    }
    cloth.computeVertexNormals();
    part(group, cloth, orange, 0.53, 3.05, 0);
  }
  return group;
}

/**
 * Arma la base, las rocas y las matas sobre el terreno. `base` es la altura que el terreno 3D toma
 * como cero.
 */
export function buildCamp(layout: CampLayout, height: HeightAt, base: number, look: CampLook): CampMeshes {
  const material = (color: string, metalness: number, roughness: number, extra: Record<string, unknown> = {}) =>
    new MeshStandardMaterial({ color, metalness, roughness, ...extra });
  const kit: BaseKit = {
    shell: new MeshStandardMaterial({ map: shellTexture(), metalness: 0.1, roughness: 0.5 }),
    white: material("#eef0f2", 0.06, 0.55),
    grey: material("#8c9199", 0.6, 0.48),
    steel: material("#b4b9c1", 0.9, 0.36),
    dark: material("#2b2e34", 0.35, 0.6),
    orange: material("#d9682f", 0.05, 0.62, { side: DoubleSide }),
    yellow: material("#c9a437", 0.25, 0.55),
    tank: material("#d5d8d6", 0.35, 0.42),
    fabric: material("#dedbd0", 0, 0.92, { flatShading: true, side: DoubleSide }),
    wood: material("#9a7b55", 0, 0.85),
    panel: new MeshPhysicalMaterial({ map: solarTexture(), metalness: 0.25, roughness: 0.16, clearcoat: 1, clearcoatRoughness: 0.06, envMapIntensity: 1.3 }),
    glass: material("#9fc4d6", 0.2, 0.08, { emissive: "#ffd58a", emissiveIntensity: 0 }),
    lamp: material("#fff3d0", 0, 0.4, { emissive: "#ffe2a0", emissiveIntensity: 0.1 }),
    beacon: material("#ff5a3c", 0, 0.5, { emissive: "#ff2a12", emissiveIntensity: 0.6 }),
    rope: material("#3a3b3e", 0, 0.9),
    dish: material("#eef0f2", 0.1, 0.5, { side: DoubleSide }),
  };
  const ground = (east: number, north: number) => height(east, north) - base;
  /** Orientación de algo apoyado en el suelo: su «arriba» sigue la pendiente del terreno. */
  const lean = (east: number, north: number, span: number) => {
    const dEast = (ground(east + span, north) - ground(east - span, north)) / (2 * span);
    const dNorth = (ground(east, north + span) - ground(east, north - span)) / (2 * span);
    return new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), new Vector3(-dEast, 1, dNorth).normalize());
  };

  // ---------- Sombras de contacto ----------
  const blob = blobTexture();
  const blobMaterial = new MeshBasicMaterial({ map: blob, color: "#000000", transparent: true, opacity: 0.4, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  const disc = new PlaneGeometry(1, 1);
  disc.rotateX(-Math.PI / 2);
  const matrix = new Matrix4();
  const blobs = (spots: { east: number; north: number; size: number }[]) => {
    const mesh = new InstancedMesh(disc, blobMaterial, Math.max(1, spots.length));
    mesh.count = spots.length;
    spots.forEach((spot, index) => {
      matrix.compose(new Vector3(spot.east, ground(spot.east, spot.north) + 0.03, -spot.north), lean(spot.east, spot.north, Math.max(0.5, spot.size / 3)), new Vector3(spot.size, 1, spot.size));
      mesh.setMatrixAt(index, matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;
    mesh.renderOrder = 1;
    return mesh;
  };

  // ---------- Base ----------
  const baseGroup = new Group();
  for (const item of layout.items) {
    const object = buildItem(item.kind, kit);
    bake(object);
    object.position.set(item.east, ground(item.east, item.north), -item.north);
    object.rotation.y = item.heading;
    baseGroup.add(object);
  }
  baseGroup.add(blobs(layout.items.filter((item) => item.radius > 0).map((item) => ({ east: item.east, north: item.north, size: item.radius * 2.5 }))));
  // De noche, dos luces de verdad: la de la puerta del módulo y la del pie de la antena.
  const lights = layout.items
    .filter((item) => item.kind === "habitat" || item.kind === "antena")
    .map((item) => {
      const light = new PointLight("#ffdca0", 0, 26, 1.8);
      const reach = item.kind === "habitat" ? 4.4 : 0.9;
      const east = item.east + Math.cos(item.heading) * reach;
      const north = item.north + Math.sin(item.heading) * reach;
      light.position.set(east, ground(east, north) + 2.5, -north);
      baseGroup.add(light);
      return light;
    });

  // ---------- Rocas ----------
  const rocks = new Group();
  // La roca toma el brillo del suelo que la rodea y parte de su color: así no desentona con él.
  const soil = new Color().setRGB(look.tint[0], look.tint[1], look.tint[2], SRGBColorSpace);
  const soilLevel = luminance(soil.r, soil.g, soil.b);
  const level = Math.min(0.6, Math.max(0.035, soilLevel * ROCK_LEVEL[look.surface]));
  const hue = (channel: number) => level * (1 - ROCK_HUE + (ROCK_HUE * channel) / Math.max(soilLevel, 1e-4));
  // Con la fotografía de roca delante, el color se divide por el medio de la fotografía: lo que se
  // ve promedia el tono buscado. Se conserva la mitad de su matiz, que es el de la piedra.
  const mean = GROUND_TEXTURES.bloque.mean;
  const meanLevel = luminance(mean[0], mean[1], mean[2]);
  const share = (channel: number, k: number) => (look.rock ? Math.min(3, hue(channel) / (0.5 * mean[k] + 0.5 * meanLevel)) : hue(channel));
  const rockColor = new Color().setRGB(share(soil.r, 0), share(soil.g, 1), share(soil.b, 2));
  const rockMaterial = new MeshStandardMaterial({
    color: rockColor,
    map: look.rock?.color ?? null,
    normalMap: look.rock?.normal ?? null,
    normalScale: new Vector2(1.4, 1.4),
    roughness: 0.94,
    metalness: 0,
  });
  const turn = new Quaternion();
  const tilt = new Quaternion();
  const up = new Vector3(0, 1, 0);
  const side = new Vector3(1, 0, 0);
  const shade = new Color();
  for (const big of [true, false]) {
    for (let variant = 0; variant < ROCK_VARIANTS; variant++) {
      const mine = layout.rocks.filter((rock) => rock.variant === variant && rock.solid === big);
      if (!mine.length) continue;
      const mesh = new InstancedMesh(rockGeometry(variant, big ? 3 : 1), rockMaterial, mine.length);
      mine.forEach((rock, index) => {
        const wobble = (rock.turn * 5.7) % 1;
        turn.setFromAxisAngle(up, rock.turn);
        tilt.setFromAxisAngle(side, (wobble - 0.5) * 0.5);
        // Una parte de la roca queda bajo el suelo.
        matrix.compose(
          new Vector3(rock.east, ground(rock.east, rock.north) + rock.size * (0.1 + 0.1 * wobble), -rock.north),
          turn.clone().multiply(tilt),
          new Vector3(rock.size, rock.size * (0.8 + 0.4 * wobble), rock.size),
        );
        mesh.setMatrixAt(index, matrix);
        mesh.setColorAt(index, shade.setScalar(0.78 + ((rock.turn * 7.3) % 1) * 0.44));
      });
      mesh.castShadow = big;
      mesh.receiveShadow = true;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      // Las rocas están repartidas por todo el campo: la caja de la primera no sirve para descartarlas.
      mesh.frustumCulled = false;
      rocks.add(mesh);
    }
  }
  rocks.add(blobs(layout.rocks.filter((rock) => rock.size >= 0.25).map((rock) => ({ east: rock.east, north: rock.north, size: rock.size * 1.9 }))));

  // ---------- Matas ----------
  const tufts = new Group();
  const sway = { uTime: { value: 0 }, uSway: { value: 0.05 } };
  let tuftMap: CanvasTexture | null = null;
  if (layout.tufts.length) {
    tuftMap = tuftTexture();
    const tuftMaterial = new MeshStandardMaterial({ map: tuftMap, alphaTest: 0.4, side: DoubleSide, roughness: 1, metalness: 0 });
    tuftMaterial.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, sway);
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nuniform float uTime;\nuniform float uSway;")
        .replace(
          "#include <begin_vertex>",
          // La punta se mece; la base no se mueve. Cada mata lleva su propio compás.
          "#include <begin_vertex>\n#ifdef USE_INSTANCING\nfloat phase = instanceMatrix[3].x * 0.9 + instanceMatrix[3].z * 0.7;\ntransformed.x += sin(uTime * 1.9 + phase) * uSway * position.y * position.y;\ntransformed.z += cos(uTime * 1.3 + phase * 1.7) * uSway * 0.6 * position.y * position.y;\n#endif",
        );
    };
    const mesh = new InstancedMesh(tuftGeometry(), tuftMaterial, layout.tufts.length);
    // Entre la paja seca y el verde, con el brillo del suelo del lugar.
    const straw = new Color("#b9a56a");
    const green = new Color("#6f7f43");
    layout.tufts.forEach((tuft, index) => {
      turn.setFromAxisAngle(up, tuft.turn);
      matrix.compose(new Vector3(tuft.east, ground(tuft.east, tuft.north) - 0.02, -tuft.north), turn, new Vector3(tuft.size * 1.5, tuft.size, tuft.size * 1.5));
      mesh.setMatrixAt(index, matrix);
      mesh.setColorAt(index, shade.copy(straw).lerp(green, (tuft.turn * 3.1) % 1).multiplyScalar(0.75 + ((tuft.turn * 9.7) % 1) * 0.4));
    });
    mesh.receiveShadow = true;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.frustumCulled = false;
    tufts.add(mesh);
  }

  return {
    base: baseGroup,
    rocks,
    tufts,
    setLight(night, overcast) {
      kit.glass.emissiveIntensity = night * 1.1;
      kit.lamp.emissiveIntensity = 0.1 + night * 3;
      for (const light of lights) light.intensity = night * 55;
      // Con el Sol fuerte ya hay sombras de verdad; con el cielo cubierto, la de contacto pesa más.
      blobMaterial.opacity = 0.2 + 0.26 * overcast + 0.1 * night;
    },
    update(time, windSpeed) {
      sway.uTime.value = time;
      sway.uSway.value = 0.03 + Math.min(0.16, windSpeed * 0.012);
      kit.beacon.emissiveIntensity = 0.5 + 2.2 * (Math.sin(time * 3.2) > 0.6 ? 1 : 0);
    },
    dispose() {
      // La fotografía de roca es de la escena, que la reutiliza: aquí solo se suelta el material.
      rockMaterial.map = null;
      rockMaterial.normalMap = null;
      disposeTree(baseGroup);
      disposeTree(rocks);
      disposeTree(tufts);
      blob.dispose();
      tuftMap?.dispose();
    },
  };
}

