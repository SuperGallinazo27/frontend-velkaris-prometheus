/**
 * Los robots del simulador en 3D, a tamaño real.
 *
 * - Perseverance y Curiosity: los modelos oficiales de NASA/JPL-Caltech (`public/modelos/`). En
 *   ellos las seis ruedas vienen fundidas en una pieza; aquí se separan por su posición para que
 *   cada una gire sobre su eje.
 * - VIPER y el carro lunar del Apolo: NASA no publica un modelo, así que se arman pieza a pieza a
 *   las medidas publicadas («forma simplificada»): paneles, aislante dorado, mástil, ruedas con
 *   tacos y suspensión. Las piezas siguen las fotos y los dibujos públicos, sin ser un plano.
 *
 * Todos miran hacia +x, con +y arriba y el origen en el suelo, bajo el centro de las ruedas.
 */
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  LatheGeometry,
  Matrix3,
  Matrix4,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  RepeatWrapping,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
  Vector2,
  Vector3,
} from "three";
import type { BufferGeometry as Geometry, Material, Object3D, Texture } from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

export interface RobotShape {
  kind: "viper" | "lrv" | "perseverance" | "curiosity";
  wheelRadius: number;
  wheelWidth: number;
  body: { length: number; width: number; height: number; wheelbase: number; track: number };
  /** Dirección del modelo oficial, si lo hay. */
  modelUrl: string | null;
}

export interface BuiltRobot {
  root: Group;
  /** Gira las ruedas hasta el ángulo acumulado dado, rad. */
  spin(angle: number): void;
  /** Dónde van los faros, en el sistema del robot, para iluminar de noche. */
  lamp: Vector3;
  /** Desde dónde mira la «cámara del robot»: la cabeza del mástil o el asiento. */
  eye: Vector3;
  /** Enciende (1) o apaga (0) los faros y pilotos del robot. */
  lights(level: number): void;
  /** true si es el modelo oficial; false si es una forma simplificada. */
  official: boolean;
  dispose(): void;
}

const TEXTURE_SLOTS = ["map", "normalMap", "roughnessMap", "metalnessMap", "aoMap", "emissiveMap", "alphaMap", "clearcoatNormalMap"] as const;

/** Libera geometrías, materiales y sus imágenes. */
export function disposeTree(root: Object3D) {
  root.traverse((node) => {
    const mesh = node as Mesh;
    if (mesh.geometry) (mesh.geometry as Geometry).dispose();
    const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
    for (const material of materials as Material[]) {
      for (const slot of TEXTURE_SLOTS) ((material as unknown as Record<string, Texture | null>)[slot] as Texture | null)?.dispose();
      material.dispose();
    }
  });
}

const standard = (color: string, metalness: number, roughness: number, extra: Record<string, unknown> = {}) =>
  new MeshStandardMaterial({ color, metalness, roughness, ...extra });

/** Ayudante para armar un robot con piezas: cada pieza proyecta y recibe sombra. */
function builder(root: Group) {
  return (geometry: Geometry, material: Material, x: number, y: number, z: number, rotation?: [number, number, number]) => {
    const mesh = new Mesh(geometry, material);
    mesh.position.set(x, y, z);
    if (rotation) mesh.rotation.set(...rotation);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);
    return mesh;
  };
}

/** Una barra entre dos puntos (un brazo, un tubo). */
export function strut(root: Group, material: Material, from: Vector3, to: Vector3, thickness: number, round = true): Mesh {
  const length = from.distanceTo(to);
  const geometry = round ? new CylinderGeometry(thickness / 2, thickness / 2, length, 10) : new BoxGeometry(thickness, length, thickness);
  const mesh = new Mesh(geometry, material);
  mesh.position.copy(from).add(to).multiplyScalar(0.5);
  // El cilindro nace vertical: se orienta de `from` a `to`.
  mesh.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), to.clone().sub(from).normalize());
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  root.add(mesh);
  return mesh;
}

/**
 * Junta en una sola malla por material todas las piezas de un grupo (salvo las de `keep`, que se
 * mueven por su cuenta, como las ruedas). Un robot armado con cientos de piezas se dibuja así con
 * una decena de llamadas, y no se nota la diferencia.
 */
export function bake(root: Group, keep: readonly Object3D[] = []): void {
  root.updateMatrixWorld(true);
  const inverse = new Matrix4().copy(root.matrixWorld).invert();
  const byMaterial = new Map<Material, { geometries: Geometry[]; sources: Mesh[] }>();
  const kept = (node: Object3D) => {
    for (let at: Object3D | null = node; at && at !== root; at = at.parent) if (keep.includes(at)) return true;
    return false;
  };
  root.traverse((node) => {
    const mesh = node as Mesh;
    if (!mesh.isMesh || Array.isArray(mesh.material) || kept(mesh)) return;
    const source = mesh.geometry as Geometry;
    const geometry = source.index ? source.toNonIndexed() : source.clone();
    geometry.applyMatrix4(new Matrix4().multiplyMatrices(inverse, mesh.matrixWorld));
    // Solo lo que usan todos los materiales: posición, normal y coordenadas de textura.
    for (const name of Object.keys(geometry.attributes)) if (!["position", "normal", "uv"].includes(name)) geometry.deleteAttribute(name);
    const entry = byMaterial.get(mesh.material) ?? { geometries: [], sources: [] };
    entry.geometries.push(geometry);
    entry.sources.push(mesh);
    byMaterial.set(mesh.material, entry);
  });
  for (const [material, { geometries, sources }] of byMaterial) {
    if (geometries.length < 2) {
      geometries.forEach((geometry) => geometry.dispose());
      continue;
    }
    const merged = mergeGeometries(geometries, false);
    geometries.forEach((geometry) => geometry.dispose());
    if (!merged) continue;
    for (const source of sources) {
      source.removeFromParent();
      (source.geometry as Geometry).dispose();
    }
    const mesh = new Mesh(merged, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);
  }
}

/** Ruido de valor periódico sobre una rejilla: la imagen que sale se repite sin costura. */
export function lattice(size: number, period: number, seed: number) {
  const values = new Float32Array(period * period);
  let state = seed;
  for (let i = 0; i < values.length; i++) {
    state = (state * 1664525 + 1013904223) >>> 0;
    values[i] = state / 4294967296;
  }
  return (x: number, y: number) => {
    const fx = (x / size) * period;
    const fy = (y / size) * period;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = fx - x0;
    const ty = fy - y0;
    const sx = tx * tx * (3 - 2 * tx);
    const sy = ty * ty * (3 - 2 * ty);
    const at = (i: number, j: number) => values[(((j % period) + period) % period) * period + (((i % period) + period) % period)];
    return (at(x0, y0) * (1 - sx) + at(x0 + 1, y0) * sx) * (1 - sy) + (at(x0, y0 + 1) * (1 - sx) + at(x0 + 1, y0 + 1) * sx) * sy;
  };
}

/** Mapa de normales a partir de una altura: con él la luz dibuja arrugas o granos sin más geometría. */
function normalFromHeight(size: number, height: (x: number, y: number) => number, strength: number): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d")!;
  const image = context.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (height(x + 1, y) - height(x - 1, y)) * strength;
      const dy = (height(x, y + 1) - height(x, y - 1)) * strength;
      const length = Math.hypot(dx, dy, 1);
      const o = (y * size + x) * 4;
      image.data[o] = (-dx / length) * 127.5 + 127.5;
      image.data[o + 1] = (-dy / length) * 127.5 + 127.5;
      image.data[o + 2] = (1 / length) * 127.5 + 127.5;
      image.data[o + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
  const texture = new CanvasTexture(canvas);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  return texture;
}

/** Arrugas del aislante térmico dorado: pliegues grandes y finos, con aristas marcadas. */
function foilNormal(): CanvasTexture {
  const size = 256;
  const a = lattice(size, 6, 11);
  const b = lattice(size, 14, 29);
  const c = lattice(size, 34, 53);
  const ridge = (v: number) => 1 - Math.abs(v * 2 - 1);
  return normalFromHeight(size, (x, y) => ridge(a(x, y)) * 0.55 + ridge(b(x, y)) * 0.3 + ridge(c(x, y)) * 0.15, 7);
}

/** Imagen de un panel solar: celdas azul oscuro, con sus hilos y las barras que las unen. */
export function solarTexture(): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const context = canvas.getContext("2d")!;
  context.fillStyle = "#c9ccd2";
  context.fillRect(0, 0, 512, 512);
  const cell = 64;
  for (let x = 0; x < 512; x += cell) {
    for (let y = 0; y < 512; y += cell) {
      const gradient = context.createLinearGradient(x, y, x + cell, y + cell);
      gradient.addColorStop(0, "#0c1630");
      gradient.addColorStop(1, (x / cell + y / cell) % 2 ? "#16264d" : "#101d3c");
      context.fillStyle = gradient;
      context.fillRect(x + 2, y + 2, cell - 4, cell - 4);
      // Hilos finos de cada celda.
      context.strokeStyle = "rgba(170,185,215,0.28)";
      context.lineWidth = 1;
      for (let k = 8; k < cell - 4; k += 8) {
        context.beginPath();
        context.moveTo(x + 2, y + k);
        context.lineTo(x + cell - 2, y + k);
        context.stroke();
      }
      context.strokeStyle = "rgba(200,210,230,0.55)";
      context.lineWidth = 2;
      for (const k of [cell / 3, (2 * cell) / 3]) {
        context.beginPath();
        context.moveTo(x + k, y + 2);
        context.lineTo(x + k, y + cell - 2);
        context.stroke();
      }
    }
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.anisotropy = 8;
  return texture;
}

/** Chapa pintada de blanco con juntas, tornillos y algo de polvo en la parte baja. */
function hullTexture(): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const context = canvas.getContext("2d")!;
  context.fillStyle = "#e9ebee";
  context.fillRect(0, 0, 512, 512);
  const grain = lattice(512, 48, 17);
  const image = context.getImageData(0, 0, 512, 512);
  for (let y = 0; y < 512; y++) {
    for (let x = 0; x < 512; x++) {
      const o = (y * 512 + x) * 4;
      const shade = 1 - 0.06 * grain(x, y);
      for (let k = 0; k < 3; k++) image.data[o + k] *= shade;
    }
  }
  context.putImageData(image, 0, 0);
  context.strokeStyle = "rgba(60,66,76,0.55)";
  context.lineWidth = 2;
  for (const [x, y, w, h] of [
    [14, 14, 236, 150],
    [262, 14, 236, 150],
    [14, 176, 150, 190],
    [176, 176, 322, 190],
    [14, 378, 484, 120],
  ]) {
    context.strokeRect(x, y, w, h);
    context.fillStyle = "rgba(70,76,86,0.85)";
    for (const [px, py] of [
      [x + 8, y + 8],
      [x + w - 8, y + 8],
      [x + 8, y + h - 8],
      [x + w - 8, y + h - 8],
    ]) {
      context.beginPath();
      context.arc(px, py, 2.6, 0, Math.PI * 2);
      context.fill();
    }
  }
  // Polvo del terreno, más en la parte baja.
  const dust = context.createLinearGradient(0, 300, 0, 512);
  dust.addColorStop(0, "rgba(150,125,95,0)");
  dust.addColorStop(1, "rgba(150,125,95,0.28)");
  context.fillStyle = dust;
  context.fillRect(0, 300, 512, 212);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

/** Los materiales que comparten las formas simplificadas. */
function paints() {
  const foilMap = foilNormal();
  foilMap.repeat.set(2, 2);
  const lamps: MeshStandardMaterial[] = [];
  const lampGlow = (color: string, emissive: string) => {
    const material = new MeshStandardMaterial({ color, emissive, emissiveIntensity: 0.15, roughness: 0.3 });
    lamps.push(material);
    return material;
  };
  return {
    white: new MeshStandardMaterial({ map: hullTexture(), metalness: 0.08, roughness: 0.52 }),
    radiator: new MeshPhysicalMaterial({ color: "#f3f5f7", metalness: 0.05, roughness: 0.28, clearcoat: 0.5, clearcoatRoughness: 0.2 }),
    foil: new MeshStandardMaterial({ color: "#d2a546", metalness: 1, roughness: 0.3, normalMap: foilMap, normalScale: new Vector2(1.1, 1.1), envMapIntensity: 1.25, side: DoubleSide }),
    aluminum: standard("#b9bec6", 0.9, 0.36),
    steel: standard("#8e949d", 0.85, 0.45),
    dark: standard("#2a2d33", 0.55, 0.5),
    black: standard("#15171b", 0.3, 0.7),
    rubber: standard("#1c1d20", 0.05, 0.9),
    glass: new MeshPhysicalMaterial({ color: "#0a0d14", metalness: 0.1, roughness: 0.05, clearcoat: 1, clearcoatRoughness: 0.03 }),
    panel: new MeshPhysicalMaterial({ map: solarTexture(), metalness: 0.25, roughness: 0.16, clearcoat: 1, clearcoatRoughness: 0.06, envMapIntensity: 1.3 }),
    lamp: lampGlow("#fff6d8", "#ffefb0"),
    lampGlow,
    lamps,
  };
}

/** Enciende o apaga los faros: de día quedan como lentes claras, de noche brillan. */
const lightSwitch = (lamps: MeshStandardMaterial[]) => (level: number) => {
  for (const lamp of lamps) lamp.emissiveIntensity = 0.12 + 2.6 * Math.min(1, Math.max(0, level));
};

/**
 * Rueda rígida metálica con tacos en uve, aro, radios y el motor en el cubo. Gira sobre su eje z;
 * `outward` es el lado que da hacia fuera del robot (+1 o −1).
 */
function grouserWheel(r: number, w: number, grousers: number, outward: number, paint: ReturnType<typeof paints>): Group {
  const wheel = new Group();
  const rim = new MeshStandardMaterial({ color: "#aeb3bb", metalness: 0.92, roughness: 0.34, side: DoubleSide });
  const drum = new Mesh(new CylinderGeometry(r - 0.014, r - 0.014, w, 48, 1, true), rim);
  drum.rotation.x = Math.PI / 2;
  drum.castShadow = true;
  drum.receiveShadow = true;
  wheel.add(drum);
  // Aros de refuerzo en los dos bordes.
  for (const side of [1, -1]) {
    const lip = new Mesh(new TorusGeometry(r - 0.012, 0.011, 8, 48), paint.steel);
    lip.position.z = side * (w / 2);
    wheel.add(lip);
  }
  // Tacos en uve: dos medias barras inclinadas que se juntan en el centro de la banda.
  const half = w / 2;
  const lug = new BoxGeometry(0.026, 0.02, half * 1.06);
  for (let k = 0; k < grousers; k++) {
    const angle = (k / grousers) * Math.PI * 2;
    for (const side of [1, -1]) {
      const piece = new Mesh(lug, paint.steel);
      const pivot = new Group();
      pivot.rotation.z = angle;
      piece.position.set(r - 0.004, 0, (side * half) / 2);
      piece.rotation.x = side * 0.2;
      pivot.add(piece);
      piece.castShadow = true;
      wheel.add(pivot);
    }
  }
  // Radios curvos y cubo, por el lado de fuera; el motor, por dentro.
  const hubZ = outward * (w / 2 - 0.035);
  const cap = new Mesh(new CylinderGeometry(r * 0.3, r * 0.34, 0.05, 24), paint.aluminum);
  cap.rotation.x = Math.PI / 2;
  cap.position.z = hubZ;
  cap.castShadow = true;
  wheel.add(cap);
  for (let k = 0; k < 6; k++) {
    const angle = (k / 6) * Math.PI * 2;
    const spoke = new Mesh(new BoxGeometry(r * 0.7, 0.045, 0.014), paint.aluminum);
    spoke.position.set(Math.cos(angle) * r * 0.62, Math.sin(angle) * r * 0.62, hubZ);
    spoke.rotation.z = angle + 0.22;
    wheel.add(spoke);
  }
  const motor = new Mesh(new CylinderGeometry(r * 0.36, r * 0.36, w * 0.62, 24), paint.dark);
  motor.rotation.x = Math.PI / 2;
  motor.position.z = -outward * w * 0.1;
  wheel.add(motor);
  return wheel;
}

/**
 * VIPER: cuerpo blanco con aislante dorado, radiador arriba, tres paneles solares casi verticales
 * (los dos costados y detrás), mástil con cámaras, faros y antena, taladro en el centro y cuatro
 * ruedas con suspensión y dirección independientes.
 */
function buildViper(shape: RobotShape): BuiltRobot {
  const root = new Group();
  const add = builder(root);
  const paint = paints();
  const { body, wheelRadius: r, wheelWidth: w } = shape;

  const boxL = 1.22;
  const boxW = 1.14;
  const bellyY = r + 0.2;
  const boxH = 0.64;
  const deckY = bellyY + boxH;
  // Cuerpo, con las aristas redondeadas, sobre una bandeja inferior.
  add(new RoundedBoxGeometry(boxL, boxH, boxW, 4, 0.045), paint.white, 0, bellyY + boxH / 2, 0);
  add(new RoundedBoxGeometry(boxL + 0.05, 0.24, boxW + 0.05, 3, 0.04), paint.foil, 0, bellyY + 0.1, 0);
  add(new BoxGeometry(boxL - 0.1, 0.05, boxW - 0.1), paint.dark, 0, bellyY - 0.035, 0);
  // Radiador del techo, con sus lamas, y asas de izado en las esquinas.
  add(new RoundedBoxGeometry(boxL + 0.08, 0.04, boxW + 0.08, 2, 0.015), paint.radiator, 0, deckY + 0.022, 0);
  for (let k = -4; k <= 4; k++) add(new BoxGeometry(boxL * 0.86, 0.012, 0.035), paint.aluminum, -0.02, deckY + 0.05, k * 0.11);
  for (const sx of [1, -1]) for (const sz of [1, -1]) add(new TorusGeometry(0.035, 0.008, 6, 14, Math.PI), paint.steel, sx * (boxL / 2 - 0.08), deckY + 0.045, sz * (boxW / 2 - 0.08));

  // Paneles solares en los dos costados y detrás, casi verticales: en el polo el Sol va muy bajo.
  const panelH = 1.04;
  const tilt = 0.2;
  const panelY = bellyY + 0.14 + (panelH / 2) * Math.cos(tilt);
  const solar = (length: number) => {
    const group = new Group();
    const face = new Mesh(new BoxGeometry(length, panelH, 0.022), [paint.radiator, paint.radiator, paint.radiator, paint.radiator, paint.panel, paint.radiator]);
    face.castShadow = true;
    face.receiveShadow = true;
    group.add(face);
    // Marco y largueros de atrás.
    for (const y of [panelH / 2, -panelH / 2]) {
      const edge = new Mesh(new BoxGeometry(length + 0.03, 0.028, 0.04), paint.aluminum);
      edge.position.y = y;
      edge.castShadow = true;
      group.add(edge);
    }
    for (const x of [length / 2, -length / 2, 0]) {
      const rib = new Mesh(new BoxGeometry(0.028, panelH, 0.04), paint.aluminum);
      rib.position.set(x, 0, x === 0 ? -0.02 : 0);
      group.add(rib);
    }
    return group;
  };
  for (const side of [1, -1]) {
    const piece = solar(boxL + 0.14);
    piece.position.set(0, panelY, side * (boxW / 2 + 0.11 + (panelH / 2) * Math.sin(tilt)));
    // La cara con celdas mira hacia fuera y el panel se abre un poco por arriba.
    piece.rotation.set(side * tilt, side > 0 ? 0 : Math.PI, 0);
    root.add(piece);
    // Bisagras que lo sujetan al cuerpo.
    for (const x of [-0.42, 0.42]) add(new BoxGeometry(0.05, 0.05, 0.14), paint.steel, x, deckY - 0.04, side * (boxW / 2 + 0.07));
  }
  const rear = solar(boxW + 0.08);
  rear.position.set(-(boxL / 2 + 0.11 + (panelH / 2) * Math.sin(tilt)), panelY, 0);
  rear.rotation.set(0, -Math.PI / 2, 0);
  rear.rotateX(tilt);
  root.add(rear);

  // Frente: instrumentos envueltos en aislante, cámaras de peligro y dos faros.
  const frontX = boxL / 2;
  add(new RoundedBoxGeometry(0.16, 0.24, 0.3, 2, 0.02), paint.foil, frontX + 0.07, bellyY + 0.36, 0.28);
  add(new RoundedBoxGeometry(0.14, 0.2, 0.26, 2, 0.02), paint.foil, frontX + 0.06, bellyY + 0.34, -0.3);
  add(new CylinderGeometry(0.05, 0.05, 0.12, 16), paint.dark, frontX + 0.13, bellyY + 0.2, 0, [0, 0, Math.PI / 2]);
  for (const side of [1, -1]) {
    add(new RoundedBoxGeometry(0.05, 0.07, 0.09, 2, 0.01), paint.dark, frontX + 0.03, deckY - 0.1, side * 0.12);
    add(new CylinderGeometry(0.022, 0.022, 0.02, 14), paint.glass, frontX + 0.06, deckY - 0.1, side * 0.12, [0, 0, Math.PI / 2]);
    add(new RoundedBoxGeometry(0.035, 0.07, 0.13, 2, 0.01), paint.lamp, frontX + 0.022, bellyY + 0.5, side * 0.44);
  }

  // Mástil delantero: cabeza que gira con dos cámaras y dos faros, y antena de alta ganancia.
  const mastX = boxL / 2 - 0.18;
  const mastZ = -0.3;
  const mastTop = body.height - 0.24;
  add(new CylinderGeometry(0.07, 0.085, 0.1, 18), paint.dark, mastX, deckY + 0.08, mastZ);
  add(new CylinderGeometry(0.036, 0.046, mastTop - deckY - 0.1, 16), paint.white, mastX, (mastTop + deckY + 0.1) / 2, mastZ);
  add(new RoundedBoxGeometry(0.1, 0.16, 0.1, 2, 0.015), paint.foil, mastX, deckY + 0.3, mastZ);
  add(new CylinderGeometry(0.05, 0.05, 0.07, 16), paint.dark, mastX, mastTop - 0.02, mastZ);
  add(new RoundedBoxGeometry(0.17, 0.15, 0.46, 3, 0.025), paint.white, mastX + 0.02, mastTop + 0.08, mastZ);
  for (const side of [1, -1]) {
    add(new CylinderGeometry(0.034, 0.034, 0.07, 16), paint.dark, mastX + 0.12, mastTop + 0.09, mastZ + side * 0.075, [0, 0, Math.PI / 2]);
    add(new CylinderGeometry(0.026, 0.026, 0.012, 16), paint.glass, mastX + 0.158, mastTop + 0.09, mastZ + side * 0.075, [0, 0, Math.PI / 2]);
    add(new RoundedBoxGeometry(0.03, 0.09, 0.09, 2, 0.01), paint.lamp, mastX + 0.108, mastTop + 0.08, mastZ + side * 0.18);
  }
  // Antena de alta ganancia: un plato sobre un cardán, al otro lado del techo.
  const dishProfile = Array.from({ length: 9 }, (_, k) => new Vector2((k / 8) * 0.23, ((k / 8) ** 2) * 0.07));
  const dishX = mastX - 0.08;
  const dishZ = 0.32;
  add(new CylinderGeometry(0.025, 0.03, 0.42, 12), paint.white, dishX, deckY + 0.26, dishZ);
  add(new RoundedBoxGeometry(0.09, 0.09, 0.09, 2, 0.015), paint.dark, dishX, deckY + 0.5, dishZ);
  const dish = add(new LatheGeometry(dishProfile, 28), new MeshStandardMaterial({ color: "#eef0f2", metalness: 0.15, roughness: 0.45, side: DoubleSide }), dishX + 0.02, deckY + 0.6, dishZ, [0, 0, -0.75]);
  const feed = new Mesh(new CylinderGeometry(0.006, 0.006, 0.16, 6), paint.steel);
  feed.position.y = 0.11;
  dish.add(feed);
  const horn = new Mesh(new CylinderGeometry(0.022, 0.014, 0.03, 10), paint.dark);
  horn.position.y = 0.19;
  dish.add(horn);
  // Antenas de baja ganancia.
  for (const z of [0.42, -0.02]) add(new CylinderGeometry(0.008, 0.008, 0.2, 6), paint.steel, -boxL / 2 + 0.16, deckY + 0.14, z);

  // Taladro TRIDENT: una columna que cruza el cuerpo, con la broca hacia el suelo.
  add(new RoundedBoxGeometry(0.17, 0.5, 0.17, 2, 0.02), paint.aluminum, -0.1, deckY + 0.24, 0.05);
  add(new CylinderGeometry(0.035, 0.035, bellyY - 0.1, 12), paint.steel, -0.1, (bellyY + 0.1) / 2, 0.05);
  add(new ConeGeometry(0.035, 0.07, 12), paint.dark, -0.1, 0.085, 0.05, [Math.PI, 0, 0]);

  // Suspensión y dirección independientes: hombro, brazo, actuador sobre la rueda y horquilla.
  const wheels: Group[] = [];
  for (const sx of [1, -1]) {
    for (const sz of [1, -1]) {
      const wx = (sx * body.wheelbase) / 2;
      const wz = (sz * body.track) / 2;
      const innerZ = wz - sz * (w / 2 + 0.07);
      const shoulder = new Vector3(sx * (boxL / 2 - 0.14), bellyY + 0.2, sz * (boxW / 2 + 0.03));
      const elbow = new Vector3(wx, 2 * r + 0.16, innerZ);
      add(new CylinderGeometry(0.06, 0.06, 0.1, 16), paint.dark, shoulder.x, shoulder.y, shoulder.z, [Math.PI / 2, 0, 0]);
      strut(root, paint.aluminum, shoulder, elbow, 0.062);
      add(new CylinderGeometry(0.068, 0.068, 0.15, 18), paint.dark, elbow.x, elbow.y - 0.03, elbow.z);
      add(new CylinderGeometry(0.075, 0.075, 0.03, 18), paint.foil, elbow.x, elbow.y + 0.05, elbow.z);
      strut(root, paint.aluminum, new Vector3(wx, 2 * r + 0.06, innerZ), new Vector3(wx, r, innerZ), 0.055, false);
      add(new CylinderGeometry(0.05, 0.05, 0.1, 14), paint.steel, wx, r, innerZ + sz * 0.045, [Math.PI / 2, 0, 0]);
      const wheel = grouserWheel(r, w, 22, sz, paint);
      wheel.position.set(wx, r, wz);
      bake(wheel);
      root.add(wheel);
      wheels.push(wheel);
    }
  }
  bake(root, wheels);
  return {
    root,
    spin: (angle) => wheels.forEach((wheel) => (wheel.rotation.z = -angle)),
    lamp: new Vector3(mastX + 0.2, mastTop + 0.08, mastZ),
    // Algo por encima y por detrás de la cabeza del mástil: abajo asoman la cabeza y el techo.
    eye: new Vector3(mastX - 0.2, mastTop + 0.42, mastZ * 0.4),
    lights: lightSwitch(paint.lamps),
    official: false,
    dispose: () => disposeTree(root),
  };
}

/** Malla de alambre de las ruedas del carro lunar, con sus chapas en uve: lo que no es alambre deja ver a través. */
function meshTextures(): { color: CanvasTexture; alpha: CanvasTexture } {
  const draw = (alpha: boolean) => {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 128;
    const context = canvas.getContext("2d")!;
    context.fillStyle = alpha ? "#000000" : "#5d6268";
    context.fillRect(0, 0, 256, 128);
    context.strokeStyle = alpha ? "#ffffff" : "#b4b9c0";
    context.lineWidth = 2.2;
    for (let k = -128; k < 384; k += 9) {
      context.beginPath();
      context.moveTo(k, 0);
      context.lineTo(k + 128, 128);
      context.moveTo(k, 128);
      context.lineTo(k + 128, 0);
      context.stroke();
    }
    // Chapas de titanio en uve: eran las que tocaban el suelo.
    context.strokeStyle = alpha ? "#ffffff" : "#d9dce0";
    context.lineWidth = 13;
    for (const x of [32, 160]) {
      context.beginPath();
      context.moveTo(x - 26, 10);
      context.lineTo(x + 26, 64);
      context.lineTo(x - 26, 118);
      context.stroke();
    }
    const texture = new CanvasTexture(canvas);
    if (!alpha) texture.colorSpace = SRGBColorSpace;
    texture.wrapS = RepeatWrapping;
    texture.repeat.set(8, 1);
    texture.anisotropy = 8;
    return texture;
  };
  return { color: draw(false), alpha: draw(true) };
}

/** Cinta tejida de los asientos. */
function webbingTexture(): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext("2d")!;
  context.fillStyle = "#b7ab8e";
  context.fillRect(0, 0, 64, 64);
  context.fillStyle = "#9c9175";
  for (let x = 0; x < 64; x += 16) for (let y = 0; y < 64; y += 16) if ((x / 16 + y / 16) % 2) context.fillRect(x, y, 16, 16);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.repeat.set(4, 4);
  return texture;
}

/**
 * Carro lunar del Apolo: bastidor abierto de aluminio, dos asientos de cinta, consola con la
 * palanca en T, baterías bajo aislante dorado, guardabarros, ruedas de malla de alambre, antena de
 * paraguas, cámara de televisión y el portaherramientas de atrás.
 */
function buildLrv(shape: RobotShape): BuiltRobot {
  const root = new Group();
  const add = builder(root);
  const paint = paints();
  const { body, wheelRadius: r, wheelWidth: w } = shape;
  const webbing = new MeshStandardMaterial({ map: webbingTexture(), metalness: 0, roughness: 0.92 });
  const fender = standard("#b8773a", 0.05, 0.62, { side: DoubleSide });
  const goldMesh = new MeshStandardMaterial({ color: "#d2a546", metalness: 1, roughness: 0.35, side: DoubleSide, wireframe: false });
  const deckY = 0.52;

  // Bastidor: dos largueros, travesaños y los tres pisos (delantero, central y trasero).
  for (const side of [1, -1]) add(new RoundedBoxGeometry(body.length, 0.075, 0.075, 2, 0.015), paint.aluminum, 0, deckY, side * 0.42);
  for (const x of [-1.45, -0.7, 0.1, 0.9, 1.45]) add(new BoxGeometry(0.06, 0.06, 0.9), paint.aluminum, x, deckY, 0);
  add(new BoxGeometry(1.5, 0.022, 0.92), paint.aluminum, -0.15, deckY + 0.045, 0);
  for (let k = -3; k <= 3; k++) add(new BoxGeometry(1.46, 0.008, 0.012), paint.steel, -0.15, deckY + 0.06, k * 0.12);
  // Dos asientos de tubo y cinta, con respaldo, reposabrazos y reposapiés.
  for (const side of [1, -1]) {
    add(new RoundedBoxGeometry(0.46, 0.05, 0.42, 2, 0.015), webbing, -0.42, deckY + 0.34, side * 0.27);
    add(new RoundedBoxGeometry(0.05, 0.52, 0.42, 2, 0.015), webbing, -0.67, deckY + 0.61, side * 0.27, [0, 0, -0.14]);
    for (const z of [0.2, -0.2]) add(new CylinderGeometry(0.014, 0.014, 0.34, 8), paint.aluminum, -0.22, deckY + 0.19, side * 0.27 + z);
    add(new BoxGeometry(0.3, 0.025, 0.34), paint.aluminum, 0.28, deckY + 0.1, side * 0.27, [0, 0, 0.35]);
    strut(root, paint.aluminum, new Vector3(-0.66, deckY + 0.36, side * 0.5), new Vector3(-0.3, deckY + 0.56, side * 0.5), 0.022);
  }
  // Consola con la pantalla y la palanca en T, entre los asientos.
  add(new RoundedBoxGeometry(0.2, 0.34, 0.3, 2, 0.02), paint.dark, 0.16, deckY + 0.43, 0);
  add(new BoxGeometry(0.012, 0.2, 0.24), paint.glass, 0.055, deckY + 0.47, 0);
  add(new CylinderGeometry(0.018, 0.018, 0.16, 8), paint.aluminum, -0.1, deckY + 0.42, 0);
  add(new RoundedBoxGeometry(0.045, 0.045, 0.15, 2, 0.01), paint.black, -0.1, deckY + 0.5, 0);
  // Baterías y electrónica delante, bajo aislante dorado y con radiadores blancos; herramientas detrás.
  add(new RoundedBoxGeometry(0.62, 0.3, 0.8, 3, 0.03), paint.foil, 1.12, deckY + 0.2, 0);
  for (const z of [0.2, -0.2]) add(new BoxGeometry(0.3, 0.012, 0.3), paint.radiator, 1.12, deckY + 0.36, z);
  add(new RoundedBoxGeometry(0.5, 0.34, 0.86, 2, 0.02), paint.white, -1.2, deckY + 0.22, 0);
  add(new BoxGeometry(0.05, 0.62, 0.86), paint.aluminum, -1.48, deckY + 0.36, 0);
  for (const z of [0.3, 0, -0.3]) add(new RoundedBoxGeometry(0.16, 0.26, 0.2, 2, 0.02), paint.white, -1.4, deckY + 0.62, z);
  // Antena de alta ganancia: un paraguas de malla dorada sobre un mástil, delante.
  add(new CylinderGeometry(0.02, 0.02, 1.25, 10), paint.aluminum, 1.22, deckY + 0.95, 0);
  const umbrella = add(new CylinderGeometry(0.46, 0.05, 0.2, 24, 1, true), goldMesh, 1.22, deckY + 1.62, 0, [0.35, 0, 0.2]);
  for (let k = 0; k < 12; k++) {
    const rib = new Mesh(new CylinderGeometry(0.005, 0.005, 0.46, 4), paint.aluminum);
    const angle = (k / 12) * Math.PI * 2;
    rib.position.set(Math.cos(angle) * 0.25, 0.01, Math.sin(angle) * 0.25);
    rib.rotation.set(0, -angle, Math.PI / 2 - 0.41);
    umbrella.add(rib);
  }
  // Antena de baja ganancia y cámara de televisión.
  add(new CylinderGeometry(0.012, 0.012, 0.9, 6), paint.aluminum, 0.2, deckY + 0.9, 0.5);
  add(new CylinderGeometry(0.03, 0.03, 0.16, 10), paint.aluminum, 0.2, deckY + 1.38, 0.5);
  add(new RoundedBoxGeometry(0.22, 0.14, 0.12, 2, 0.015), paint.foil, 1.3, deckY + 0.78, -0.42);
  add(new CylinderGeometry(0.035, 0.035, 0.07, 12), paint.glass, 1.43, deckY + 0.78, -0.42, [0, 0, Math.PI / 2]);
  add(new CylinderGeometry(0.015, 0.015, 0.5, 6), paint.aluminum, 1.3, deckY + 0.5, -0.42);

  const mesh = meshTextures();
  const tread = new MeshStandardMaterial({ map: mesh.color, alphaMap: mesh.alpha, alphaTest: 0.35, metalness: 0.75, roughness: 0.45, side: DoubleSide });
  const wheels: Group[] = [];
  for (const sx of [1, -1]) {
    for (const sz of [1, -1]) {
      const wx = (sx * body.wheelbase) / 2;
      const wz = (sz * body.track) / 2;
      const wheel = new Group();
      const tire = new Mesh(new CylinderGeometry(r, r, w, 44, 1, true), tread);
      tire.rotation.x = Math.PI / 2;
      tire.castShadow = true;
      wheel.add(tire);
      // Aro interior que limitaba cuánto cedía la malla, y cubo con el motor.
      const bump = new Mesh(new CylinderGeometry(r * 0.78, r * 0.78, w * 0.7, 32, 1, true), new MeshStandardMaterial({ color: "#8d939b", metalness: 0.8, roughness: 0.5, side: DoubleSide }));
      bump.rotation.x = Math.PI / 2;
      wheel.add(bump);
      const disc = new Mesh(new CylinderGeometry(r * 0.42, r * 0.42, w * 0.55, 24), paint.aluminum);
      disc.rotation.x = Math.PI / 2;
      disc.castShadow = true;
      wheel.add(disc);
      for (let k = 0; k < 8; k++) {
        const spoke = new Mesh(new BoxGeometry(r * 1.56, 0.016, 0.016), paint.steel);
        spoke.rotation.z = (k / 8) * Math.PI;
        spoke.position.z = sz * w * 0.2;
        wheel.add(spoke);
      }
      wheel.position.set(wx, r, wz);
      bake(wheel);
      root.add(wheel);
      wheels.push(wheel);
      // Guardabarros, con su prolongación trasera, y brazos de la suspensión.
      // Con el cilindro tumbado sobre el eje de la rueda, el ángulo π queda arriba: el arco cubre la parte alta.
      const guard = new Mesh(new CylinderGeometry(r + 0.07, r + 0.07, w + 0.1, 28, 1, true, Math.PI * 0.56, Math.PI * 0.88), fender);
      guard.rotation.x = Math.PI / 2;
      guard.position.set(wx, r, wz);
      guard.castShadow = true;
      root.add(guard);
      const reach = Math.abs(wz) - 0.42;
      for (const y of [r + 0.12, r - 0.08]) add(new BoxGeometry(0.05, 0.035, reach), paint.aluminum, wx, y, sz * (0.42 + reach / 2));
      strut(root, paint.steel, new Vector3(wx, deckY, sz * 0.42), new Vector3(wx, r + 0.02, wz - sz * (w / 2 + 0.04)), 0.03);
    }
  }
  bake(root, wheels);
  return {
    root,
    spin: (angle) => wheels.forEach((wheel) => (wheel.rotation.z = -angle)),
    lamp: new Vector3(1.5, deckY + 0.5, 0),
    // La altura de los ojos de quien conduce, en el asiento izquierdo.
    eye: new Vector3(-0.5, deckY + 1.18, 0.27),
    lights: lightSwitch(paint.lamps),
    official: false,
    dispose: () => disposeTree(root),
  };
}

/**
 * Rover de seis ruedas con formas simples: se usa solo si el modelo oficial no llega a cargarse.
 */
function buildSixWheeler(shape: RobotShape): BuiltRobot {
  const root = new Group();
  const add = builder(root);
  const paint = paints();
  const { body, wheelRadius: r, wheelWidth: w } = shape;
  const deckY = r * 2 + 0.52;
  add(new RoundedBoxGeometry(1.9, 0.42, 1.5, 3, 0.04), paint.white, -0.1, deckY, 0);
  add(new RoundedBoxGeometry(0.75, 0.5, 0.6, 2, 0.03), paint.dark, -1.25, deckY + 0.2, 0, [0, 0, 0.5]);
  add(new CylinderGeometry(0.05, 0.05, body.height - deckY - 0.3, 12), paint.white, 0.7, (body.height + deckY) / 2 - 0.05, 0.5);
  add(new RoundedBoxGeometry(0.28, 0.24, 0.5, 2, 0.03), paint.white, 0.74, body.height - 0.14, 0.5);
  const wheels: Group[] = [];
  for (const sz of [1, -1]) {
    add(new BoxGeometry(body.wheelbase, 0.07, 0.07), paint.aluminum, 0, r + 0.42, sz * (body.track / 2 - w / 2 - 0.12), [0, 0, 0.06 * sz]);
    for (const along of [1, 0, -1]) {
      const wheel = grouserWheel(r, w, 24, sz, paint);
      wheel.position.set((along * body.wheelbase) / 2, r, (sz * body.track) / 2);
      bake(wheel);
      root.add(wheel);
      wheels.push(wheel);
      add(new BoxGeometry(0.06, 0.44, 0.06), paint.aluminum, (along * body.wheelbase) / 2, r + 0.22, sz * (body.track / 2 - w / 2 - 0.12));
    }
  }
  return {
    root,
    spin: (angle) => wheels.forEach((wheel) => (wheel.rotation.z = -angle)),
    lamp: new Vector3(1, deckY + 0.3, 0),
    eye: new Vector3(0.5, body.height + 0.2, 0.3),
    lights: lightSwitch(paint.lamps),
    official: false,
    dispose: () => disposeTree(root),
  };
}

/** Qué mallas del modelo son las ruedas: una pieza llamada «Wheels_objs» o un material «wheels». */
const isWheelMesh = (mesh: Mesh) =>
  /wheels_objs/i.test(mesh.name) || /wheels_objs/i.test(mesh.parent?.name ?? "") || (mesh.material as Material | undefined)?.name === "wheels";

/** Los dos cortes que separan en tres grupos una lista de valores ordenada: sus dos huecos más grandes. */
function threeGroups(sorted: number[]): [number, number] {
  const gaps: { value: number; size: number }[] = [];
  for (let k = 1; k < sorted.length; k++) gaps.push({ value: (sorted[k] + sorted[k - 1]) / 2, size: sorted[k] - sorted[k - 1] });
  const [first, second] = gaps.sort((a, b) => b.size - a.size);
  return first.value < second.value ? [first.value, second.value] : [second.value, first.value];
}

/**
 * Separa las ruedas de un modelo de NASA, que vienen fundidas en una pieza, en seis ruedas que
 * giran sobre su eje. Los triángulos se reparten por lado (signo de x) y por posición a lo largo
 * (z), donde quedan en tres grupos bien separados.
 */
function splitWheels(model: Object3D): Group[] {
  model.updateMatrixWorld(true);
  const sources: Mesh[] = [];
  model.traverse((node) => {
    if ((node as Mesh).isMesh && isWheelMesh(node as Mesh)) sources.push(node as Mesh);
  });
  if (!sources.length) return [];

  // Posiciones de todos los vértices de rueda, en el sistema del modelo.
  const point = new Vector3();
  const world = sources.map((mesh) => {
    const position = mesh.geometry.getAttribute("position");
    const out = new Float32Array(position.count * 3);
    for (let i = 0; i < position.count; i++) {
      point.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
      out.set([point.x, point.y, point.z], i * 3);
    }
    return out;
  });
  let minX = Infinity;
  let maxX = -Infinity;
  for (const positions of world) {
    for (let i = 0; i < positions.length; i += 3) {
      minX = Math.min(minX, positions[i]);
      maxX = Math.max(maxX, positions[i]);
    }
  }
  const middleX = (minX + maxX) / 2;
  const along: number[] = [];
  for (const positions of world) for (let i = 2; i < positions.length; i += 3 * 16) along.push(positions[i]);
  const [cutA, cutB] = threeGroups(along.sort((a, b) => a - b));
  const groupOf = (x: number, z: number) => (x > middleX ? 0 : 3) + (z < cutA ? 0 : z < cutB ? 1 : 2);

  // Caja de cada rueda, para saber su centro.
  const boxes = Array.from({ length: 6 }, () => ({ min: new Vector3(Infinity, Infinity, Infinity), max: new Vector3(-Infinity, -Infinity, -Infinity) }));
  for (const positions of world) {
    for (let i = 0; i < positions.length; i += 3) {
      const box = boxes[groupOf(positions[i], positions[i + 2])];
      point.set(positions[i], positions[i + 1], positions[i + 2]);
      box.min.min(point);
      box.max.max(point);
    }
  }
  const wheels = boxes.map((box) => {
    const wheel = new Group();
    wheel.position.copy(box.min).add(box.max).multiplyScalar(0.5);
    return wheel;
  });

  sources.forEach((mesh, meshIndex) => {
    const geometry = mesh.geometry;
    const positions = world[meshIndex];
    const normal = geometry.getAttribute("normal");
    const uv = geometry.getAttribute("uv");
    const index = geometry.getIndex();
    const triangles = (index ? index.count : positions.length / 3) / 3;
    const corner = (triangle: number, k: number) => (index ? index.getX(triangle * 3 + k) : triangle * 3 + k);
    const normalMatrix = new Matrix3().getNormalMatrix(mesh.matrixWorld);
    // Por rueda: los vértices que usa (renumerados) y sus triángulos.
    const remap = Array.from({ length: 6 }, () => new Map<number, number>());
    const faces: number[][] = Array.from({ length: 6 }, () => []);
    for (let t = 0; t < triangles; t++) {
      const a = corner(t, 0);
      const b = corner(t, 1);
      const c = corner(t, 2);
      const x = (positions[a * 3] + positions[b * 3] + positions[c * 3]) / 3;
      const z = (positions[a * 3 + 2] + positions[b * 3 + 2] + positions[c * 3 + 2]) / 3;
      const group = groupOf(x, z);
      for (const vertex of [a, b, c]) {
        let mapped = remap[group].get(vertex);
        if (mapped === undefined) {
          mapped = remap[group].size;
          remap[group].set(vertex, mapped);
        }
        faces[group].push(mapped);
      }
    }
    for (let group = 0; group < 6; group++) {
      const count = remap[group].size;
      if (!count) continue;
      const center = wheels[group].position;
      const outPosition = new Float32Array(count * 3);
      const outNormal = normal ? new Float32Array(count * 3) : null;
      const outUv = uv ? new Float32Array(count * 2) : null;
      for (const [vertex, mapped] of remap[group]) {
        outPosition.set([positions[vertex * 3] - center.x, positions[vertex * 3 + 1] - center.y, positions[vertex * 3 + 2] - center.z], mapped * 3);
        if (outNormal && normal) {
          point.fromBufferAttribute(normal, vertex).applyNormalMatrix(normalMatrix);
          outNormal.set([point.x, point.y, point.z], mapped * 3);
        }
        if (outUv && uv) outUv.set([uv.getX(vertex), uv.getY(vertex)], mapped * 2);
      }
      const part = new BufferGeometry();
      part.setAttribute("position", new BufferAttribute(outPosition, 3));
      if (outNormal) part.setAttribute("normal", new BufferAttribute(outNormal, 3));
      if (outUv) part.setAttribute("uv", new BufferAttribute(outUv, 2));
      part.setIndex(faces[group]);
      const piece = new Mesh(part, mesh.material);
      piece.castShadow = true;
      wheels[group].add(piece);
    }
    mesh.removeFromParent();
    geometry.dispose();
  });
  for (const wheel of wheels) model.add(wheel);
  return wheels;
}

/** Carga el modelo oficial de NASA, lo orienta hacia +x y separa sus ruedas. */
async function loadOfficial(shape: RobotShape): Promise<BuiltRobot> {
  const gltf = await new GLTFLoader().loadAsync(shape.modelUrl!);
  const model = gltf.scene;
  const wheels = splitWheels(model);
  if (wheels.length !== 6) {
    disposeTree(model);
    throw new Error("El modelo no tiene las ruedas donde se esperaba");
  }
  model.traverse((node) => {
    const mesh = node as Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    // Con el cielo como entorno, el metal y los paneles del modelo reflejan lo que tienen alrededor.
    for (const material of (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as MeshStandardMaterial[]) {
      if (material && "envMapIntensity" in material) material.envMapIntensity = 1;
    }
  });
  // El modelo mira hacia +z: se gira para que mire hacia +x y se centra entre el eje delantero y el trasero.
  const front = Math.max(...wheels.map((wheel) => wheel.position.z));
  const rear = Math.min(...wheels.map((wheel) => wheel.position.z));
  model.position.z = -(front + rear) / 2;
  const root = new Group();
  const turned = new Group();
  turned.rotation.y = Math.PI / 2;
  turned.add(model);
  root.add(turned);
  return {
    root,
    // En el modelo, el eje de las ruedas es x y avanzar es rodar hacia +z.
    spin: (angle) => wheels.forEach((wheel) => (wheel.rotation.x = angle)),
    lamp: new Vector3(1.1, 1.9, 0),
    // Por encima de la cubierta, hacia delante: abajo asoman el brazo y las ruedas delanteras.
    eye: new Vector3(0.45, shape.body.height + 0.28, 0.1),
    lights: () => undefined,
    official: true,
    dispose: () => disposeTree(root),
  };
}

/** Construye el robot. Si el modelo oficial no carga, devuelve una forma simplificada y lo dice. */
export async function buildRobot(shape: RobotShape): Promise<BuiltRobot> {
  if (shape.kind === "viper") return buildViper(shape);
  if (shape.kind === "lrv") return buildLrv(shape);
  if (shape.modelUrl) {
    try {
      return await loadOfficial(shape);
    } catch {
      // Sin red o con el archivo dañado: mejor una forma simple que una escena vacía.
    }
  }
  return buildSixWheeler(shape);
}

/**
 * Una roca: una esfera deformada con bultos grandes y pequeños, de base aplastada. `detail` es el
 * número de caras (1 para las piedras pequeñas, 2 o 3 para las que se ven de cerca).
 */
export function rockGeometry(variant: number, detail = 2): BufferGeometry {
  const segments = detail <= 1 ? [8, 6] : detail === 2 ? [14, 10] : [22, 16];
  const geometry = new SphereGeometry(0.5, segments[0], segments[1]);
  const position = geometry.getAttribute("position");
  const point = new Vector3();
  const seed = variant * 17.31 + 3.7;
  // Ruido suave a partir de senos: el mismo punto da siempre el mismo bulto, también en la costura.
  const lump = (x: number, y: number, z: number, f: number) =>
    Math.sin(x * f + seed) * Math.cos(y * f * 1.13 - seed * 0.7) + Math.sin(z * f * 0.91 + seed * 1.3) * Math.cos((x + y) * f * 0.77 + seed * 0.4);
  const stretch = [1 + 0.35 * Math.sin(seed), 0.62 + 0.22 * Math.cos(seed * 1.7), 1 + 0.3 * Math.cos(seed * 0.6)];
  for (let i = 0; i < position.count; i++) {
    point.fromBufferAttribute(position, i);
    const n = point.clone().normalize();
    const bump = 1 + 0.2 * lump(n.x, n.y, n.z, 2.1) + 0.09 * lump(n.x, n.y, n.z, 5.3) + 0.04 * lump(n.x, n.y, n.z, 11.7);
    // La parte baja se aplasta: la roca se apoya, no rueda.
    const flat = n.y < -0.25 ? 0.55 : 1;
    position.setXYZ(i, point.x * bump * stretch[0], point.y * bump * stretch[1] * flat, point.z * bump * stretch[2]);
  }
  geometry.computeVertexNormals();
  // La costura de la esfera repite vértices: sus normales se igualan para que no se note.
  const normal = geometry.getAttribute("normal");
  const columns = segments[0] + 1;
  for (let row = 0; row <= segments[1]; row++) {
    const a = row * columns;
    const b = a + segments[0];
    const nx = normal.getX(a) + normal.getX(b);
    const ny = normal.getY(a) + normal.getY(b);
    const nz = normal.getZ(a) + normal.getZ(b);
    const length = Math.hypot(nx, ny, nz) || 1;
    normal.setXYZ(a, nx / length, ny / length, nz / length);
    normal.setXYZ(b, nx / length, ny / length, nz / length);
  }
  return geometry;
}
