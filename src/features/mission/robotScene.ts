/**
 * Escena 3D del simulador: el relieve real de los 18 km del lugar, con su imagen satelital y el
 * grano del suelo de cerca, el cielo con el Sol y el tiempo de ahora, el robot a tamaño real con
 * ruedas que giran y se hunden, sus surcos y su polvo, el destino, y un campo con una base, rocas
 * y matas. La altura no se exagera.
 *
 * Coordenadas: x = este, z = −norte, y = altura sobre el punto más bajo del área (m).
 * El robot mira hacia +x en su propio sistema; su derecha es +z.
 *
 * El relieve se dibuja con dos mallas que casan sin grietas: cerca del robot, una ventana con todo
 * el detalle del dato (30 m); el resto, con un punto de cada cuatro. La ventana sigue al robot.
 */
import {
  ACESFilmicToneMapping,
  BackSide,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  FogExp2,
  Group,
  HemisphereLight,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NormalBlending,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  Points,
  Raycaster,
  RepeatWrapping,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Spherical,
  SpotLight,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";
import type { Texture, WebGLRenderTarget } from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { Surface } from "../world/terrainReading";
import { chaseRig, clampLook } from "./cameraRig";
import type { CampLayout } from "./camp";
import { buildCamp } from "./campModels";
import type { CampMeshes } from "./campModels";
import type { HeightAt } from "./drive";
import { loadGround } from "./groundTextures";
import type { LoadedGround } from "./groundTextures";
import type { BuiltRobot, RobotShape } from "./robotModels";
import { skyPalette } from "./sky";
import type { RGB, SkyState } from "./sky";
import type { TerrainGrid } from "./twin";

export interface ScenePose {
  east: number;
  north: number;
  /** Dirección de avance, unitaria (este, norte). */
  dx: number;
  dy: number;
  /** Hundimiento de las ruedas, m. */
  sinkage: number;
  /** Giro acumulado de las ruedas, rad. */
  wheelAngle: number;
  /** Patinaje de 0 a 1, si se conoce: con más patinaje, las ruedas levantan más polvo. */
  slip?: number;
}

/**
 * Detrás del robot mirando lo que tiene delante, desde la cabeza del robot, libre alrededor de él,
 * desde arriba o el área entera.
 */
export type CameraMode = "seguir" | "robot" | "libre" | "cenital" | "area";
export const CAMERA_MODES: readonly CameraMode[] = ["seguir", "robot", "libre", "cenital", "area"];

export type TerrainLayer = "satelite" | "pendiente";
/** Cuánto detalle se dibuja: «media» es para equipos lentos. */
export type Quality = "alta" | "media";
/** Las huellas como surcos, o pintadas con el patinaje que hubo en cada tramo. */
export type TrackStyle = "surco" | "patinaje";

export interface RobotScene {
  setTerrain(grid: TerrainGrid, height: HeightAt): void;
  /** Imagen satelital del área entera, con el norte arriba. */
  setImagery(satellite: HTMLCanvasElement | null): void;
  /** Colores de pendiente para el robot elegido. */
  setSlopeImage(slope: HTMLCanvasElement | null): void;
  setLayer(layer: TerrainLayer): void;
  setContours(on: boolean): void;
  /** Qué cubre el suelo: decide el grano de cerca y el tono de las rocas. */
  setGround(surface: Surface, secondary: Surface | null): void;
  /** Suelo mojado: más oscuro y brillante, con charcos y sin polvo. */
  setWet(on: boolean): void;
  setQuality(quality: Quality): void;
  setRobot(robot: BuiltRobot, shape: RobotShape): void;
  setPose(pose: ScenePose): void;
  setTarget(target: { east: number; north: number } | null): void;
  /** Añade un tramo de huella; `slipColor` es el color de su patinaje (RGB de 0 a 1). */
  addTrack(pose: ScenePose, slipColor: readonly [number, number, number]): void;
  setTrackStyle(style: TrackStyle): void;
  clearTrack(): void;
  /** Base, rocas y matas del campo; null los quita. */
  setCamp(layout: CampLayout | null, rocksOn: boolean): void;
  setSky(state: SkyState): void;
  setCamera(mode: CameraMode): void;
  /** Píxeles del lienzo que tapan los avisos de arriba y los datos de abajo: la imagen se centra en lo que queda. */
  setInsets(top: number, bottom: number): void;
  /** Clic (sin arrastrar) sobre el terreno, en metros desde el centro del área. */
  onPick: ((east: number, north: number) => void) | null;
  /** Cada cuadro, con los segundos transcurridos desde el anterior. */
  onFrame: ((dt: number) => void) | null;
  /** Se llama una vez si con la calidad alta la imagen va a trompicones. */
  onSlow: (() => void) | null;
  dispose(): void;
}

/** Tramos de huella que se guardan; al llenarse, se borran los más viejos. */
const TRACK_CAPACITY = 4200;
/** Cada tramo son seis cintas: el fondo del surco y un cordón de tierra a cada lado, por cada lado del robot. */
const TRACK_VERTS = 36;
/** Las huellas pintadas con el patinaje se oscurecen para que se lean como surcos. */
const TRACK_SHADE = 0.8;
/** Dibujo de los tacos: se repite cada tantos metros de huella. */
const TREAD_M = 0.22;
/** La malla lejana usa un punto de cada STEP; la ventana de detalle mide WINDOW celdas de lado. */
const STEP = 4;
const WINDOW = 128;
/** Bajo el punto más bajo del área, un plano enorme hace de horizonte. */
const FLOOR_Y = -45;
const DUST_COUNT = 520;
/** Ángulo de visión de las cámaras, en grados. */
const FOV = 48;
const FOV_ONBOARD = 64;

const TERRAIN_VERTEX_HEAD = /* glsl */ `
varying vec3 vWorld;
`;
const TERRAIN_VERTEX_BODY = /* glsl */ `
vWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
`;
const TERRAIN_FRAGMENT_HEAD = /* glsl */ `
uniform sampler2D uDetail;
uniform float uDetailOn;
uniform float uContours;
uniform float uBase;
uniform sampler2D uGround;
uniform sampler2D uGroundNormal;
uniform vec3 uGroundMean;
uniform float uGroundTile;
uniform float uGroundOn;
uniform sampler2D uSecond;
uniform sampler2D uSecondNormal;
uniform vec3 uSecondMean;
uniform float uSecondTile;
uniform float uSecondOn;
uniform float uWet;
uniform float uBump;
varying vec3 vWorld;
// Lo que se calcula al pintar el color y se reutiliza al calcular la luz.
float gNear = 0.0;
float gSecond = 0.0;
float gPuddle = 0.0;
vec3 gBump = vec3(0.0, 0.0, 1.0);
// Curva de nivel: fina y nítida a cualquier distancia; se apaga sola cuando quedarían demasiado juntas.
float contourLine(float height, float interval) {
  float v = height / interval;
  float w = fwidth(v);
  float d = abs(fract(v - 0.5) - 0.5) / max(w, 1e-5);
  return (1.0 - smoothstep(0.6, 1.7, d)) * (1.0 - smoothstep(0.1, 0.32, w));
}
// La fotografía del material, dividida por su color medio: varía el color del satélite sin cambiarlo.
// Va a dos escalas: de cerca manda la fina; a media distancia, la ancha, que es la que aún se distingue.
vec3 groundRatio(sampler2D map, vec3 mean, float tile, float wideShare) {
  vec3 fine = texture2D(map, vWorld.xz / tile).rgb;
  vec3 wide = texture2D(map, vWorld.xz / (tile * 5.3) + 0.37).rgb;
  vec3 ratio = clamp(mix(fine, wide, wideShare) / max(mean, vec3(0.012)), 0.25, 2.6);
  // Algo más de contraste: con el cielo cubierto es lo que da relieve.
  return pow(ratio, vec3(1.2));
}
// Relieve fino del material: hacia dónde se inclina cada punto (xy) y cuánto mira hacia arriba (z).
vec3 groundBump(sampler2D map, float tile, float wideShare) {
  vec3 fine = texture2D(map, vWorld.xz / tile).xyz * 2.0 - 1.0;
  vec3 wide = texture2D(map, vWorld.xz / (tile * 5.3) + 0.37).xyz * 2.0 - 1.0;
  return mix(fine, wide, wideShare);
}
`;
const TERRAIN_FRAGMENT_COLOR = /* glsl */ `
{
  float camDistance = distance(vWorld, cameraPosition);
  gNear = 1.0 - smoothstep(16.0, 150.0, camDistance);
  if (uDetailOn > 0.5) {
    float patches = texture2D(uDetail, vWorld.xz * 0.045 + 0.37).g;
    float broad = texture2D(uDetail, vWorld.xz * 0.0061 + 0.11).g;
    // Manchas anchas: rompen el color parejo también a media distancia.
    float midFade = 1.0 - smoothstep(140.0, 1500.0, camDistance);
    diffuseColor.rgb *= mix(1.0, 0.84 + 0.32 * mix(patches, broad, 0.5), midFade);
    if (uGroundOn > 0.5) {
      float wideShare = 0.2 + 0.65 * smoothstep(5.0, 32.0, camDistance);
      vec3 ratio = groundRatio(uGround, uGroundMean, uGroundTile, wideShare);
      gBump = groundBump(uGroundNormal, uGroundTile, wideShare);
      if (uSecondOn > 0.5) {
        // La segunda superficie aparece en manchas.
        gSecond = smoothstep(0.5, 0.63, mix(patches, broad, 0.4));
        ratio = mix(ratio, groundRatio(uSecond, uSecondMean, uSecondTile, wideShare), gSecond);
        gBump = mix(gBump, groundBump(uSecondNormal, uSecondTile, wideShare), gSecond);
      }
      // Los huecos entre las piedras reciben menos luz del cielo.
      float cavity = mix(1.0, smoothstep(0.72, 1.0, gBump.z), 0.6) * 1.06;
      diffuseColor.rgb *= mix(vec3(1.0), ratio * cavity, gNear);
    } else {
      // Mientras carga la fotografía del material, un grano dibujado.
      float fine = texture2D(uDetail, vWorld.xz * 0.37).r;
      diffuseColor.rgb *= mix(1.0, 0.6 + 0.8 * fine, gNear);
    }
    if (uWet > 0.01) {
      // Suelo mojado: más oscuro, y con charcos en los sitios llanos.
      float level = inverseTransformDirection(normalize(vNormal), viewMatrix).y;
      gPuddle = uWet * smoothstep(0.6, 0.69, mix(patches, broad, 0.55)) * smoothstep(0.985, 0.998, level) * (1.0 - smoothstep(60.0, 260.0, camDistance));
      diffuseColor.rgb *= mix(1.0, 0.6, uWet) * mix(1.0, 0.62, gPuddle);
    }
  }
  if (uContours > 0.5) {
    float h = vWorld.y + uBase;
    float line = max(max(contourLine(h, 1.0) * 0.18, contourLine(h, 5.0) * 0.38), max(contourLine(h, 25.0) * 0.52, contourLine(h, 100.0) * 0.68));
    diffuseColor.rgb *= 1.0 - line;
  }
}
`;
const TERRAIN_FRAGMENT_ROUGHNESS = /* glsl */ `
roughnessFactor = mix(roughnessFactor, 0.56, uWet * 0.85);
roughnessFactor = mix(roughnessFactor, 0.045, gPuddle);
`;
const TERRAIN_FRAGMENT_NORMAL = /* glsl */ `
if (uDetailOn > 0.5 && uGroundOn > 0.5 && uBump > 0.001 && gNear > 0.01) {
  // Relieve fino del material: inclina la normal del suelo, así la luz dibuja el grano.
  vec2 bump = gBump.xy * (uBump * gNear * (1.0 - gPuddle));
  normal = normalize(normal + (viewMatrix * vec4(bump.x, 0.0, bump.y, 0.0)).xyz);
}
`;

const SKY_VERTEX = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 view = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * view;
  // Siempre al fondo, detrás de todo lo demás.
  gl_Position.z = gl_Position.w;
}
`;
const SKY_FRAGMENT = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGround;
uniform vec3 uSunColor;
uniform vec3 uSunDir;
uniform vec3 uCloudLight;
uniform vec3 uCloudDark;
uniform float uCloud;
uniform float uSunDisc;
uniform float uStars;
uniform float uTime;
uniform vec2 uWind;
varying vec3 vDir;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
  float amplitude = 0.5;
  float sum = 0.0;
  for (int k = 0; k < 5; k++) {
    sum += amplitude * noise(p);
    p = p * 2.03 + 17.0;
    amplitude *= 0.5;
  }
  return sum;
}
void main() {
  vec3 dir = normalize(vDir);
  float up = clamp(dir.y, 0.0, 1.0);
  // El azul se aclara hacia el horizonte, donde la luz cruza más aire, y más aún del lado del Sol.
  float sunDot = max(dot(dir, uSunDir), 0.0);
  vec3 color = mix(uHorizon, uZenith, pow(up, 0.42));
  color = mix(color, uHorizon * 1.06, pow(1.0 - up, 9.0) * 0.55);
  color += uSunColor * pow(sunDot, 4.0) * 0.1 * (1.0 - up) * uSunDisc;
  color += uSunColor * (pow(sunDot, 9.0) * 0.3 + pow(sunDot, 90.0) * 0.55 + smoothstep(0.99986, 0.99996, sunDot) * 7.0) * uSunDisc;
  if (uStars > 0.01) {
    vec2 cell = dir.xz / (abs(dir.y) + 0.4) * 110.0;
    color += vec3(step(0.9972, hash(floor(cell)))) * smoothstep(0.03, 0.25, dir.y) * uStars;
  }
  if (dir.y > 0.0 && uCloud > 0.01) {
    // Nubes sobre un plano alto; su cantidad sigue a la nubosidad real y se mueven con el viento.
    vec2 p = dir.xz / (dir.y + 0.09) * 0.85 + uWind * uTime;
    float body = fbm(p * 1.25) + 0.28 * fbm(p * 4.3 + 5.0) - 0.14;
    float edge = 1.0 - uCloud * 1.08;
    float cover = smoothstep(edge, edge + 0.3, body);
    // La panza de la nube es más oscura que su borde; del lado del Sol, el borde se enciende.
    float thick = smoothstep(edge + 0.05, edge + 0.55, body);
    vec3 cloud = mix(uCloudLight, uCloudDark, thick * 0.85);
    cloud = mix(cloud, mix(uCloudDark, uCloudLight, smoothstep(0.25, 0.75, fbm(p * 2.7 + 3.0))), 0.45);
    cloud += uSunColor * pow(sunDot, 6.0) * 0.25 * (1.0 - thick) * uSunDisc;
    color = mix(color, cloud, cover * smoothstep(0.0, 0.1, dir.y) * 0.96);
  }
  if (dir.y < 0.0) color = mix(color, uGround, smoothstep(0.0, -0.12, dir.y));
  gl_FragColor = vec4(color, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const FALL_VERTEX = /* glsl */ `
uniform vec3 uBox;
uniform vec3 uFall;
uniform float uTime;
uniform float uStreak;
uniform float uSize;
attribute vec3 aSeed;
attribute float aEnd;
varying float vAlpha;
void main() {
  // Cada gota vive en una caja que rodea a la cámara: al salir por un lado, entra por el otro.
  vec3 moved = aSeed * uBox + uFall * uTime;
  vec3 relative = mod(moved - cameraPosition + uBox * 0.5, uBox) - uBox * 0.5;
  vec3 world = cameraPosition + relative - uFall * (aEnd * uStreak);
  vec4 view = viewMatrix * vec4(world, 1.0);
  gl_Position = projectionMatrix * view;
  gl_PointSize = uSize * (160.0 / max(1.0, -view.z));
  vAlpha = 1.0 - smoothstep(uBox.x * 0.32, uBox.x * 0.5, length(relative.xz));
}
`;
const FALL_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying float vAlpha;
void main() {
  gl_FragColor = vec4(uColor, uOpacity * vAlpha);
}
`;

const DUST_VERTEX = /* glsl */ `
uniform float uTime;
uniform vec3 uWind;
uniform float uScale;
attribute vec3 aVelocity;
attribute vec2 aLife;
varying float vAlpha;
void main() {
  float age = uTime - aLife.x;
  float t = clamp(age / aLife.y, 0.0, 1.0);
  // Sube frenándose y se la lleva el viento.
  vec3 world = position + aVelocity * age * (1.0 - 0.45 * t) + uWind * age * t;
  vec4 view = viewMatrix * vec4(world, 1.0);
  gl_Position = projectionMatrix * view;
  gl_PointSize = uScale * (0.35 + 1.25 * t) / max(0.5, -view.z);
  vAlpha = age < 0.0 || age > aLife.y ? 0.0 : (1.0 - t) * smoothstep(0.0, 0.12, t);
}
`;
const DUST_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float soft = 1.0 - smoothstep(0.25, 1.0, d);
  if (soft * vAlpha < 0.004) discard;
  gl_FragColor = vec4(uColor, soft * vAlpha * uOpacity);
}
`;

/** Ruido de valor periódico: una rejilla de `period` celdas cuyos bordes coinciden. */
function lattice(size: number, period: number, seed: number) {
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

/** Imagen pequeña y repetible con ruido: rojo, grano fino; verde, manchas. */
function detailTexture(): CanvasTexture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d")!;
  const image = context.createImageData(size, size);
  const fineA = lattice(size, 128, 7);
  const fineB = lattice(size, 64, 19);
  const fineC = lattice(size, 32, 43);
  const patchA = lattice(size, 8, 71);
  const patchB = lattice(size, 16, 97);
  const patchC = lattice(size, 4, 131);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const fine = fineA(x, y) * 0.5 + fineB(x, y) * 0.3 + fineC(x, y) * 0.2;
      const patch = patchA(x, y) * 0.45 + patchB(x, y) * 0.3 + patchC(x, y) * 0.25;
      const o = (y * size + x) * 4;
      // Se estira el contraste: la media queda cerca de 0,5.
      image.data[o] = Math.min(255, Math.max(0, (0.5 + (fine - 0.5) * 2.1) * 255));
      image.data[o + 1] = Math.min(255, Math.max(0, (0.5 + (patch - 0.5) * 1.9) * 255));
      image.data[o + 2] = 128;
      image.data[o + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
  const texture = new CanvasTexture(canvas);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  return texture;
}

/** Dibujo de la huella: a la izquierda, las marcas de los tacos; a la derecha, tierra suelta lisa. */
function treadTexture(): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext("2d")!;
  context.fillStyle = "#c8c8c8";
  context.fillRect(0, 0, 64, 64);
  context.fillStyle = "#ffffff";
  context.fillRect(32, 0, 32, 64);
  context.fillStyle = "#6f6f6f";
  for (const y of [6, 38]) {
    // Marca en uve de cada taco.
    context.beginPath();
    context.moveTo(2, y);
    context.lineTo(16, y + 9);
    context.lineTo(30, y);
    context.lineTo(30, y + 9);
    context.lineTo(16, y + 18);
    context.lineTo(2, y + 9);
    context.closePath();
    context.fill();
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  return texture;
}

/** Mancha que se apaga hacia los bordes: la sombra de contacto bajo el robot. */
function shadowTexture(): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext("2d")!;
  const gradient = context.createRadialGradient(32, 32, 4, 32, 32, 32);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.55, "rgba(255,255,255,0.7)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 64, 64);
  return new CanvasTexture(canvas);
}

/** true si el navegador dibuja con el procesador (sin tarjeta gráfica): ahí todo va más lento. */
function softwareRenderer(renderer: WebGLRenderer): boolean {
  try {
    const gl = renderer.getContext();
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    const name = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "";
    return /swiftshader|llvmpipe|software/i.test(name);
  } catch {
    return false;
  }
}

/** La calidad con la que conviene empezar en este equipo. */
export function defaultQuality(): Quality {
  if (typeof window === "undefined") return "alta";
  const memory = (navigator as { deviceMemory?: number }).deviceMemory;
  const slow = window.matchMedia("(pointer: coarse)").matches || (memory !== undefined && memory <= 4) || navigator.hardwareConcurrency <= 4;
  return slow ? "media" : "alta";
}

export function createRobotScene(container: HTMLElement, options: { calm?: boolean; quality?: Quality } = {}): RobotScene {
  const calm = options.calm ?? false;
  let quality: Quality = options.quality ?? "alta";
  const renderer = new WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  const software = softwareRenderer(renderer);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.04;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  const scene = new Scene();
  const fog = new FogExp2("#b7d3ee", 0.00004);
  let fogDensity = fog.density;
  scene.fog = fog;
  const camera = new PerspectiveCamera(FOV, 1, 0.3, 600_000);
  camera.position.set(-10, 6, 6);
  /** Ángulo de visión de la cámara elegida y píxeles del lienzo tapados arriba y abajo. */
  let viewFov = FOV;
  let insetTop = 0;
  let insetBottom = 0;
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = !calm;
  controls.maxPolarAngle = Math.PI * 0.495;
  controls.minDistance = 2;
  controls.maxDistance = 40_000;
  controls.zoomSpeed = 1.3;

  const hemisphere = new HemisphereLight("#dfeaf5", "#6b5a48", 1);
  const sun = new DirectionalLight("#fff3dd", 2.6);
  sun.castShadow = true;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  // De noche, una luz tenue y azulada deja adivinar el relieve.
  const moon = new DirectionalLight("#8fa6dc", 0);
  moon.position.set(-0.4, 1, 0.3);
  scene.add(hemisphere, sun, sun.target, moon);
  const sunDirection = new Vector3(0.6, 0.6, 0.5).normalize();
  let shadowReach = 40;

  // ---------- Cielo ----------
  const skyUniforms = {
    uZenith: { value: new Color("#2c6fc7") },
    uHorizon: { value: new Color("#b7d3ee") },
    uGround: { value: new Color("#6f675b") },
    uSunColor: { value: new Color("#fff4e2") },
    uSunDir: { value: sunDirection },
    uCloudLight: { value: new Color("#ffffff") },
    uCloudDark: { value: new Color("#8c95a1") },
    uCloud: { value: 0.1 },
    uSunDisc: { value: 1 },
    uStars: { value: 0 },
    uTime: { value: 0 },
    uWind: { value: new Vector2(0.004, 0) },
  };
  const skyMaterial = new ShaderMaterial({ uniforms: skyUniforms, vertexShader: SKY_VERTEX, fragmentShader: SKY_FRAGMENT, side: BackSide, depthWrite: false, fog: false });
  const skyGeometry = new SphereGeometry(1000, 32, 20);
  const sky = new Mesh(skyGeometry, skyMaterial);
  sky.frustumCulled = false;
  sky.renderOrder = -10;
  scene.add(sky);
  // El mismo cielo, en una escena aparte, da los reflejos del metal, de los paneles y de los charcos.
  const reflectionScene = new Scene();
  reflectionScene.add(new Mesh(skyGeometry, skyMaterial));
  const pmrem = new PMREMGenerator(renderer);
  let reflection: WebGLRenderTarget | null = null;
  let daylight = 1;
  let overcast = 0;
  let raining = false;
  let windSpeed = 0;
  const wind = new Vector3();

  // ---------- Lluvia y nieve ----------
  const FALL_COUNT = 3200;
  const fallSeeds = new Float32Array(FALL_COUNT * 2 * 3);
  const fallEnds = new Float32Array(FALL_COUNT * 2);
  let seedState = 12345;
  const nextSeed = () => {
    seedState = (seedState * 1664525 + 1013904223) >>> 0;
    return seedState / 4294967296;
  };
  for (let i = 0; i < FALL_COUNT; i++) {
    const seed = [nextSeed(), nextSeed(), nextSeed()];
    fallSeeds.set(seed, i * 6);
    fallSeeds.set(seed, i * 6 + 3);
    fallEnds[i * 2 + 1] = 1;
  }
  const fallGeometry = new BufferGeometry();
  fallGeometry.setAttribute("position", new BufferAttribute(new Float32Array(FALL_COUNT * 2 * 3), 3));
  fallGeometry.setAttribute("aSeed", new BufferAttribute(fallSeeds, 3));
  fallGeometry.setAttribute("aEnd", new BufferAttribute(fallEnds, 1));
  const fallUniforms = {
    uBox: { value: new Vector3(46, 30, 46) },
    uFall: { value: new Vector3(0, -9, 0) },
    uTime: { value: 0 },
    uStreak: { value: 0.05 },
    uSize: { value: 3 },
    uColor: { value: new Color("#dfe8f2") },
    uOpacity: { value: 0.5 },
  };
  const fallMaterial = new ShaderMaterial({ uniforms: fallUniforms, vertexShader: FALL_VERTEX, fragmentShader: FALL_FRAGMENT, transparent: true, depthWrite: false, fog: false });
  const rain = new LineSegments(fallGeometry, fallMaterial);
  const snow = new Points(fallGeometry, fallMaterial);
  for (const object of [rain, snow]) {
    object.frustumCulled = false;
    object.visible = false;
    object.renderOrder = 5;
    scene.add(object);
  }

  // ---------- Terreno ----------
  let grid: TerrainGrid | null = null;
  let heightAt: HeightAt = () => 0;
  let base = 0;
  let areaSize = 18_000;
  let normals = new Float32Array(0);
  let lod = false;
  let windowRow = -1;
  let windowCol = -1;
  let farMesh: Mesh | null = null;
  let nearMesh: Mesh | null = null;
  const detail = detailTexture();
  const terrainUniforms = {
    uDetail: { value: detail },
    uDetailOn: { value: 1 },
    uContours: { value: 0 },
    uBase: { value: 0 },
    uGround: { value: detail as Texture },
    uGroundNormal: { value: detail as Texture },
    uGroundMean: { value: new Vector3(0.2, 0.2, 0.2) },
    uGroundTile: { value: 2 },
    uGroundOn: { value: 0 },
    uSecond: { value: detail as Texture },
    uSecondNormal: { value: detail as Texture },
    uSecondMean: { value: new Vector3(0.2, 0.2, 0.2) },
    uSecondTile: { value: 2 },
    uSecondOn: { value: 0 },
    uWet: { value: 0 },
    uBump: { value: 0.85 },
  };
  const terrainMaterial = new MeshStandardMaterial({ color: "#ffffff", roughness: 1, metalness: 0, side: DoubleSide });
  terrainMaterial.envMapIntensity = 0;
  terrainMaterial.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, terrainUniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${TERRAIN_VERTEX_HEAD}`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>\n${TERRAIN_VERTEX_BODY}`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${TERRAIN_FRAGMENT_HEAD}`)
      .replace("#include <map_fragment>", `#include <map_fragment>\n${TERRAIN_FRAGMENT_COLOR}`)
      .replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>\n${TERRAIN_FRAGMENT_ROUGHNESS}`)
      .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>\n${TERRAIN_FRAGMENT_NORMAL}`);
  };
  let satellite: CanvasTexture | null = null;
  let satelliteImage: HTMLCanvasElement | null = null;
  let slopeMap: CanvasTexture | null = null;
  let layer: TerrainLayer = "satelite";
  /** Color medio del área entera según el satélite, y el del suelo que rodea al robot. */
  let tint: RGB = [0.55, 0.51, 0.45];
  let nearTint: RGB = tint;
  let nearTintAt: { east: number; north: number } | null = null;
  const probe = document.createElement("canvas");
  probe.width = 8;
  probe.height = 8;
  const probeContext = probe.getContext("2d", { willReadFrequently: true });
  let wet = false;
  const floor = new Mesh(new CircleGeometry(450_000, 72), new MeshBasicMaterial({ color: "#8d8372" }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = FLOOR_Y;
  scene.add(floor);

  // Fotografías de los materiales del suelo y de las rocas: se cargan una vez y se reutilizan.
  const grounds = new Map<Surface | "bloque", LoadedGround>();
  let disposed = false;
  let groundSurface: Surface = "suelo";
  let groundSecond: Surface | null = null;
  const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const fetchGround = (name: Surface | "bloque") =>
    grounds.has(name)
      ? Promise.resolve(grounds.get(name)!)
      : loadGround(name, anisotropy).then((loaded) => {
          if (disposed) {
            loaded.color.dispose();
            loaded.normal.dispose();
            throw new Error("La escena ya se cerró");
          }
          grounds.set(name, loaded);
          return loaded;
        });

  // ---------- Robot ----------
  const holder = new Group();
  holder.rotation.order = "YZX";
  scene.add(holder);
  let robot: BuiltRobot | null = null;
  let shape: RobotShape | null = null;
  const robotPosition = new Vector3();
  let heading = Math.PI / 2;
  const headlight = new SpotLight("#fff2cf", 0, 70, 0.62, 0.55, 1.4);
  headlight.castShadow = false;
  holder.add(headlight, headlight.target);
  // Sombra de contacto bajo el robot: con el cielo cubierto el Sol no da sombra.
  const shadowMap = shadowTexture();
  const underShadow = new Mesh(
    new PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
    new MeshBasicMaterial({ map: shadowMap, color: "#000000", transparent: true, opacity: 0.4, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
  );
  underShadow.renderOrder = 2;
  holder.add(underShadow);

  // ---------- Huellas ----------
  // Por cada tramo y cada lado del robot: el fondo del surco y un cordón de tierra a cada lado. Todo
  // en un mismo búfer que se reutiliza en anillo.
  const trackGeometry = new BufferGeometry();
  const trackPositions = new Float32Array(TRACK_CAPACITY * TRACK_VERTS * 3);
  const trackNormals = new Float32Array(TRACK_CAPACITY * TRACK_VERTS * 3);
  const trackUvs = new Float32Array(TRACK_CAPACITY * TRACK_VERTS * 2);
  const trackColors = new Float32Array(TRACK_CAPACITY * TRACK_VERTS * 3);
  // Los dos juegos de colores: el del surco y el del patinaje. Se muestra uno u otro.
  const rutColors = new Float32Array(TRACK_CAPACITY * TRACK_VERTS * 3);
  const slipColors = new Float32Array(TRACK_CAPACITY * TRACK_VERTS * 3);
  trackGeometry.setAttribute("position", new BufferAttribute(trackPositions, 3));
  trackGeometry.setAttribute("normal", new BufferAttribute(trackNormals, 3));
  trackGeometry.setAttribute("uv", new BufferAttribute(trackUvs, 2));
  trackGeometry.setAttribute("color", new BufferAttribute(trackColors, 3));
  trackGeometry.setDrawRange(0, 0);
  const tread = treadTexture();
  const trackMaterial = new MeshStandardMaterial({ vertexColors: true, map: tread, roughness: 0.96, metalness: 0, side: DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  trackMaterial.envMapIntensity = 0;
  const tracks = new Mesh(trackGeometry, trackMaterial);
  tracks.frustumCulled = false;
  tracks.receiveShadow = true;
  scene.add(tracks);
  let trackCount = 0;
  let trackNext = 0;
  let trackLength = 0;
  let trackStyle: TrackStyle = "surco";
  let lastTrack: { left: Vector3; right: Vector3 } | null = null;

  // ---------- Polvo ----------
  const dustGeometry = new BufferGeometry();
  const dustPositions = new Float32Array(DUST_COUNT * 3);
  const dustVelocities = new Float32Array(DUST_COUNT * 3);
  const dustLives = new Float32Array(DUST_COUNT * 2).fill(-100);
  dustGeometry.setAttribute("position", new BufferAttribute(dustPositions, 3));
  dustGeometry.setAttribute("aVelocity", new BufferAttribute(dustVelocities, 3));
  dustGeometry.setAttribute("aLife", new BufferAttribute(dustLives, 2));
  const dustUniforms = {
    uTime: { value: 0 },
    uWind: { value: new Vector3() },
    uScale: { value: 600 },
    uColor: { value: new Color("#c9b99c") },
    uOpacity: { value: 0.3 },
  };
  const dust = new Points(dustGeometry, new ShaderMaterial({ uniforms: dustUniforms, vertexShader: DUST_VERTEX, fragmentShader: DUST_FRAGMENT, transparent: true, depthWrite: false, blending: NormalBlending, fog: false }));
  dust.frustumCulled = false;
  dust.renderOrder = 4;
  scene.add(dust);
  let dustNext = 0;
  let dustDebt = 0;
  let lastWheelAngle = 0;
  let lastSlip = 0;

  // Destino: una bandera y, de lejos, una señal alta.
  const flag = new Group();
  const pole = new Mesh(new CylinderGeometry(0.035, 0.035, 2.6, 8), new MeshStandardMaterial({ color: "#f1f1f1", metalness: 0.6, roughness: 0.4 }));
  pole.position.y = 1.3;
  const cloth = new Mesh(new BoxGeometry(0.8, 0.5, 0.02), new MeshStandardMaterial({ color: "#e0533a", emissive: "#5a1408" }));
  cloth.position.set(0.42, 2.3, 0);
  pole.castShadow = true;
  cloth.castShadow = true;
  flag.add(pole, cloth);
  flag.visible = false;
  scene.add(flag);
  const beaconGeometry = new CylinderGeometry(0.5, 0.5, 1, 8);
  const makeBeacon = (color: string) => {
    const mesh = new Mesh(beaconGeometry, new MeshBasicMaterial({ color, transparent: true, opacity: 0.85, fog: false }));
    mesh.visible = false;
    scene.add(mesh);
    return mesh;
  };
  const robotBeacon = makeBeacon("#ffd166");
  const flagBeacon = makeBeacon("#ff7a5c");

  // ---------- Campo: base, rocas y matas ----------
  let camp: CampMeshes | null = null;
  let campLayout: CampLayout | null = null;
  let campRocksOn = true;

  const toWorld = (east: number, north: number, lift = 0) => new Vector3(east, heightAt(east, north) - base + lift, -north);

  function applyLayer() {
    terrainMaterial.map = layer === "satelite" ? satellite : slopeMap;
    terrainUniforms.uDetailOn.value = layer === "satelite" ? 1 : 0;
    terrainMaterial.needsUpdate = true;
  }
  const toTexture = (canvas: HTMLCanvasElement | null) => {
    if (!canvas) return null;
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return texture;
  };

  /** Lo que cambia con la calidad: nitidez, alcance y finura de las sombras, y relieve fino del suelo. */
  function applyQuality() {
    const high = quality === "alta";
    renderer.setPixelRatio(Math.min(high ? 2 : 1.25, window.devicePixelRatio));
    const size = high ? 2048 : 1024;
    shadowReach = high ? 40 : 26;
    if (sun.shadow.mapSize.x !== size) {
      sun.shadow.mapSize.set(size, size);
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
    }
    Object.assign(sun.shadow.camera, { left: -shadowReach, right: shadowReach, top: shadowReach, bottom: -shadowReach, near: 1, far: 320 });
    sun.shadow.camera.updateProjectionMatrix();
    terrainUniforms.uBump.value = high ? 0.85 : 0.5;
    applyView();
  }

  /**
   * Ajusta la imagen al tamaño del lienzo. El centro de la imagen no es el del lienzo, sino el de
   * lo que queda a la vista entre los avisos de arriba y los datos de abajo: así el robot no se
   * esconde tras ellos. En pantallas estrechas se abre el ángulo para que quepa lo mismo.
   */
  function applyView() {
    const width = container.clientWidth;
    const height = container.clientHeight;
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    const shift = Math.min(height * 0.25, Math.max(0, (insetBottom - insetTop) / 2));
    const full = height + 2 * shift;
    const narrow = Math.max(1, Math.sqrt(1.25 / (width / height)));
    const half = Math.tan((viewFov * Math.PI) / 360) * Math.min(narrow, 1.7);
    // Con el centro desplazado, el ángulo es el de una imagen más alta de la que se ve.
    camera.fov = (2 * Math.atan((half * full) / height) * 180) / Math.PI;
    camera.aspect = width / full;
    if (shift > 0.5) camera.setViewOffset(width, full, 0, 2 * shift, width, height);
    else camera.clearViewOffset();
    camera.updateProjectionMatrix();
  }

  /** Pone las fotografías del suelo en el material del terreno. */
  function applyGround() {
    const first = grounds.get(groundSurface);
    const second = groundSecond && groundSecond !== groundSurface ? grounds.get(groundSecond) : undefined;
    terrainUniforms.uGroundOn.value = first ? 1 : 0;
    if (first) {
      terrainUniforms.uGround.value = first.color;
      terrainUniforms.uGroundNormal.value = first.normal;
      terrainUniforms.uGroundMean.value.set(...first.info.mean);
      terrainUniforms.uGroundTile.value = first.info.tileM;
    }
    // En calidad media solo se dibuja la superficie principal.
    terrainUniforms.uSecondOn.value = second && quality === "alta" ? 1 : 0;
    if (second) {
      terrainUniforms.uSecond.value = second.color;
      terrainUniforms.uSecondNormal.value = second.normal;
      terrainUniforms.uSecondMean.value.set(...second.info.mean);
      terrainUniforms.uSecondTile.value = second.info.tileM;
    }
  }

  /** Normal de cada punto de la malla, con diferencias centrales: igual en las dos mallas, para que la luz no salte entre ellas. */
  function computeNormals(source: TerrainGrid) {
    const points = source.cells + 1;
    const cell = source.sizeM / source.cells;
    const out = new Float32Array(points * points * 3);
    const at = (r: number, c: number) => source.heights[Math.min(points - 1, Math.max(0, r)) * points + Math.min(points - 1, Math.max(0, c))];
    for (let r = 0; r < points; r++) {
      for (let c = 0; c < points; c++) {
        const dEast = (at(r, c + 1) - at(r, c - 1)) / (2 * cell);
        const dNorth = (at(r + 1, c) - at(r - 1, c)) / (2 * cell);
        const length = Math.hypot(dEast, 1, dNorth);
        out.set([-dEast / length, 1 / length, dNorth / length], (r * points + c) * 3);
      }
    }
    return out;
  }

  /** Geometría con los puntos (fila, columna) dados; `heightOf` permite ajustar la altura de los bordes. */
  function patch(rows: number[], cols: number[], heightOf: (r: number, c: number) => number): BufferGeometry {
    const source = grid!;
    const points = source.cells + 1;
    const cell = source.sizeM / source.cells;
    const half = source.sizeM / 2;
    const count = rows.length * cols.length;
    const positions = new Float32Array(count * 3);
    const normal = new Float32Array(count * 3);
    const uvs = new Float32Array(count * 2);
    rows.forEach((r, i) => {
      cols.forEach((c, j) => {
        const k = i * cols.length + j;
        positions.set([c * cell - half, heightOf(r, c) - base, -(r * cell - half)], k * 3);
        normal.set(normals.subarray((r * points + c) * 3, (r * points + c) * 3 + 3), k * 3);
        uvs.set([c / source.cells, r / source.cells], k * 2);
      });
    });
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(positions, 3));
    geometry.setAttribute("normal", new BufferAttribute(normal, 3));
    geometry.setAttribute("uv", new BufferAttribute(uvs, 2));
    return geometry;
  }

  /** Dos triángulos por celda, partidos por la misma diagonal que usa `meshSampler`. */
  function quads(rowCount: number, colCount: number, skip?: (i: number, j: number) => boolean): number[] {
    const indices: number[] = [];
    for (let i = 0; i < rowCount - 1; i++) {
      for (let j = 0; j < colCount - 1; j++) {
        if (skip?.(i, j)) continue;
        const a = i * colCount + j;
        indices.push(a, a + 1, a + colCount, a + 1, a + colCount + 1, a + colCount);
      }
    }
    return indices;
  }

  const range = (from: number, to: number, step: number) => Array.from({ length: Math.floor((to - from) / step) + 1 }, (_, k) => from + k * step);

  /** Coloca la ventana de detalle alrededor del robot y rehace las dos mallas donde cambian. */
  function placeWindow(east: number, north: number, force = false) {
    if (!grid || !lod || !farMesh) return;
    const cell = grid.sizeM / grid.cells;
    const col = (east + grid.sizeM / 2) / cell;
    const row = (north + grid.sizeM / 2) / cell;
    const centered = (value: number) => Math.min(grid!.cells - WINDOW, Math.max(0, Math.round((value - WINDOW / 2) / STEP) * STEP));
    // Solo se mueve cuando el robot se aleja del centro un cuarto de la ventana.
    const drift = Math.max(Math.abs(row - (windowRow + WINDOW / 2)), Math.abs(col - (windowCol + WINDOW / 2)));
    if (!force && windowRow >= 0 && drift < WINDOW / 4) return;
    windowRow = centered(row);
    windowCol = centered(col);

    const source = grid;
    const points = source.cells + 1;
    const h = (r: number, c: number) => source.heights[r * points + c];
    // En el borde, los puntos intermedios se apoyan en la línea de la malla lejana: no quedan grietas.
    const stitched = (r: number, c: number) => {
      const onRowEdge = r === windowRow || r === windowRow + WINDOW;
      const onColEdge = c === windowCol || c === windowCol + WINDOW;
      if (onRowEdge && c % STEP !== 0) {
        const c0 = Math.floor(c / STEP) * STEP;
        return h(r, c0) + ((h(r, c0 + STEP) - h(r, c0)) * (c - c0)) / STEP;
      }
      if (onColEdge && r % STEP !== 0) {
        const r0 = Math.floor(r / STEP) * STEP;
        return h(r0, c) + ((h(r0 + STEP, c) - h(r0, c)) * (r - r0)) / STEP;
      }
      return h(r, c);
    };
    const rows = range(windowRow, windowRow + WINDOW, 1);
    const cols = range(windowCol, windowCol + WINDOW, 1);
    const geometry = patch(rows, cols, stitched);
    geometry.setIndex(quads(rows.length, cols.length));
    if (nearMesh) {
      nearMesh.geometry.dispose();
      nearMesh.geometry = geometry;
    } else {
      nearMesh = new Mesh(geometry, terrainMaterial);
      nearMesh.receiveShadow = true;
      scene.add(nearMesh);
    }
    // La malla lejana deja el hueco de la ventana.
    const across = source.cells / STEP + 1;
    const r0 = windowRow / STEP;
    const c0 = windowCol / STEP;
    const size = WINDOW / STEP;
    farMesh.geometry.setIndex(quads(across, across, (i, j) => i >= r0 && i < r0 + size && j >= c0 && j < c0 + size));
  }

  /** Color medio de un trozo de una imagen (sRGB, de 0 a 1); null si no se puede leer. */
  function averageColor(image: HTMLCanvasElement, x: number, y: number, width: number, height: number): RGB | null {
    if (!probeContext || width <= 0 || height <= 0) return null;
    try {
      probeContext.drawImage(image, x, y, width, height, 0, 0, 8, 8);
      const data = probeContext.getImageData(0, 0, 8, 8).data;
      const sum = [0, 0, 0];
      for (let i = 0; i < data.length; i += 4) for (let k = 0; k < 3; k++) sum[k] += data[i + k];
      return sum.map((value) => value / (64 * 255)) as RGB;
    } catch {
      return null;
    }
  }

  /**
   * Color del suelo en unos 300 m alrededor de un punto, según el satélite. Se vuelve a medir cuando
   * el robot se aleja: las huellas y el polvo van cambiando de tono con el terreno.
   */
  function tintNear(east: number, north: number): RGB {
    if (!satelliteImage) return tint;
    if (nearTintAt && Math.hypot(east - nearTintAt.east, north - nearTintAt.north) < 120) return nearTint;
    const perMeter = satelliteImage.width / areaSize;
    const reach = 150 * perMeter;
    const x = Math.min(satelliteImage.width - 2 * reach, Math.max(0, (east + areaSize / 2) * perMeter - reach));
    const y = Math.min(satelliteImage.height - 2 * reach, Math.max(0, (areaSize / 2 - north) * perMeter - reach));
    nearTint = averageColor(satelliteImage, x, y, 2 * reach, 2 * reach) ?? tint;
    nearTintAt = { east, north };
    // El polvo es del color del suelo, algo más claro.
    dustUniforms.uColor.value.setRGB(Math.min(1, nearTint[0] * 1.25 + 0.12), Math.min(1, nearTint[1] * 1.22 + 0.11), Math.min(1, nearTint[2] * 1.18 + 0.1), "srgb");
    return nearTint;
  }

  /** Vuelve a armar la base, las rocas y las matas (al cambiar el suelo, la calidad o el color). */
  function rebuildCamp() {
    if (camp) {
      scene.remove(camp.base, camp.rocks, camp.tufts);
      camp.dispose();
      camp = null;
    }
    if (!campLayout || !grid) return;
    const rock = grounds.get("bloque");
    // Las rocas toman el tono del suelo que hay alrededor de la base, no el medio de los 18 km.
    const around = tintNear(campLayout.base.east, campLayout.base.north);
    camp = buildCamp(campLayout, heightAt, base, { tint: around, surface: groundSurface, rock: rock ? { color: rock.color, normal: rock.normal } : null });
    camp.rocks.visible = campRocksOn;
    camp.setLight(1 - daylight, overcast);
    scene.add(camp.base, camp.rocks, camp.tufts);
  }

  /** Muestra en las huellas los colores del surco o los del patinaje. */
  function paintTracks() {
    trackColors.set(trackStyle === "surco" ? rutColors : slipColors);
    trackGeometry.attributes.color.needsUpdate = true;
    trackMaterial.map = trackStyle === "surco" ? tread : null;
    trackMaterial.needsUpdate = true;
  }

  // ---------- Cámara ----------
  let cameraMode: CameraMode = "seguir";
  let lastInteraction = -Infinity;
  let interacting = false;
  const onControlStart = () => {
    interacting = true;
  };
  const onControlEnd = () => {
    interacting = false;
    lastInteraction = performance.now();
  };
  controls.addEventListener("start", onControlStart);
  controls.addEventListener("end", onControlEnd);
  const spherical = new Spherical();
  const offset = new Vector3();
  const desired = new Vector3();
  let lastHeading = heading;
  let lastSpot = new Vector3();
  // Hacia dónde mira la cámara del robot respecto al frente: se cambia arrastrando.
  let look = { yaw: 0, pitch: -0.2 };

  const robotSize = () => (shape ? Math.max(shape.body.length, 1.6) : 2);

  /** Punto del suelo por delante del robot al que mira la cámara «Seguir». */
  function aheadPoint(out: Vector3) {
    const rig = chaseRig(robotSize());
    const east = robotPosition.x + Math.cos(heading) * rig.ahead;
    const north = -robotPosition.z + Math.sin(heading) * rig.ahead;
    // Sobre el suelo de ese punto: cuesta arriba mira a la ladera y cuesta abajo, al fondo.
    return out.set(east, heightAt(east, north) - base + rig.lift, -north);
  }

  /** En «seguir», la cámara vuelve poco a poco detrás del robot y mantiene la vista por delante de él. */
  function chase(dt: number, now: number) {
    const moving = Math.abs(heading - lastHeading) > 1e-4 || lastSpot.distanceToSquared(robotPosition) > 1e-6;
    lastHeading = heading;
    lastSpot = robotPosition.clone();
    if (cameraMode !== "seguir") return;
    offset.copy(camera.position).sub(controls.target);
    spherical.setFromVector3(offset);
    if (!interacting && moving && now - lastInteraction > 2500) {
      // Detrás del robot: en el sistema de Three.js, el ángulo se mide desde +z hacia +x.
      const wanted = Math.atan2(-Math.cos(heading), Math.sin(heading));
      let difference = wanted - spherical.theta;
      difference = Math.atan2(Math.sin(difference), Math.cos(difference));
      spherical.theta += difference * (calm ? 1 : 1 - Math.exp(-dt * 2.4));
    }
    controls.target.lerp(aheadPoint(desired), calm ? 1 : 1 - Math.exp(-dt * 5));
    camera.position.copy(controls.target).add(offset.setFromSpherical(spherical));
  }

  /** La cámara del robot: en la cabeza del mástil, mirando hacia donde mira el robot. */
  function onboard() {
    if (!robot) return;
    holder.updateMatrixWorld();
    camera.position.copy(robot.eye).applyMatrix4(holder.matrixWorld);
    // Hacia delante según el robot (cuesta arriba o abajo incluidos), más lo que se haya girado la vista.
    const forward = new Vector3(1, 0, 0).transformDirection(holder.matrixWorld);
    const yaw = Math.atan2(-forward.z, forward.x) + look.yaw;
    const pitch = Math.asin(Math.min(1, Math.max(-1, forward.y))) + look.pitch;
    const direction = new Vector3(Math.cos(pitch) * Math.cos(yaw), Math.sin(pitch), -Math.cos(pitch) * Math.sin(yaw));
    camera.up.set(0, 1, 0);
    camera.lookAt(desired.copy(camera.position).add(direction));
  }

  // Clic sin arrastrar: elige un punto del terreno. En la cámara del robot, arrastrar gira la vista.
  const raycaster = new Raycaster();
  let down: { x: number; y: number } | null = null;
  let dragLook: { x: number; y: number; yaw: number; pitch: number } | null = null;
  const onDown = (event: PointerEvent) => {
    down = { x: event.clientX, y: event.clientY };
    if (cameraMode === "robot") dragLook = { x: event.clientX, y: event.clientY, yaw: look.yaw, pitch: look.pitch };
  };
  const onMove = (event: PointerEvent) => {
    if (!dragLook || cameraMode !== "robot") return;
    look = clampLook(dragLook.yaw - (event.clientX - dragLook.x) * 0.004, dragLook.pitch + (event.clientY - dragLook.y) * 0.003);
  };
  const onUp = (event: PointerEvent) => {
    dragLook = null;
    if (!down || !farMesh || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 5) return;
    const box = renderer.domElement.getBoundingClientRect();
    const pointer = new Vector2(((event.clientX - box.left) / box.width) * 2 - 1, -((event.clientY - box.top) / box.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(nearMesh ? [nearMesh, farMesh] : [farMesh])[0];
    if (hit) api.onPick?.(hit.point.x, -hit.point.z);
  };
  const onCancel = () => {
    dragLook = null;
  };
  renderer.domElement.addEventListener("pointerdown", onDown);
  renderer.domElement.addEventListener("pointermove", onMove);
  renderer.domElement.addEventListener("pointerup", onUp);
  renderer.domElement.addEventListener("pointercancel", onCancel);
  renderer.domElement.addEventListener("pointerleave", onCancel);

  const api: RobotScene = {
    onPick: null,
    onFrame: null,
    onSlow: null,

    setTerrain(next, height) {
      grid = next;
      heightAt = height;
      areaSize = next.sizeM;
      base = Infinity;
      for (const value of next.heights) base = Math.min(base, value);
      terrainUniforms.uBase.value = base;
      normals = computeNormals(next);
      lod = next.cells % STEP === 0 && next.cells >= WINDOW + 2 * STEP;
      const points = next.cells + 1;
      const all = lod ? range(0, next.cells, STEP) : range(0, next.cells, 1);
      const geometry = patch(all, all, (r, c) => next.heights[r * points + c]);
      geometry.setIndex(quads(all.length, all.length));
      if (farMesh) {
        farMesh.geometry.dispose();
        farMesh.geometry = geometry;
      } else {
        farMesh = new Mesh(geometry, terrainMaterial);
        farMesh.receiveShadow = true;
        scene.add(farMesh);
      }
      if (!lod && nearMesh) {
        scene.remove(nearMesh);
        nearMesh.geometry.dispose();
        nearMesh = null;
      }
      windowRow = -1;
      placeWindow(robotPosition.x, -robotPosition.z, true);
      applyLayer();
    },

    setImagery(next) {
      satellite?.dispose();
      satellite = toTexture(next);
      satelliteImage = next;
      nearTintAt = null;
      if (next) {
        // Color medio de la imagen: tiñe el plano del horizonte y la luz que rebota en el suelo.
        tint = averageColor(next, 0, 0, next.width, next.height) ?? tint;
        (floor.material as MeshBasicMaterial).color.setRGB(tint[0], tint[1], tint[2], "srgb");
        skyUniforms.uGround.value.setRGB(tint[0] * 0.8, tint[1] * 0.8, tint[2] * 0.8, "srgb");
        // Las rocas, el polvo y las huellas toman el color del suelo que rodea al robot.
        tintNear(robotPosition.x, -robotPosition.z);
        rebuildCamp();
      }
      applyLayer();
    },

    setSlopeImage(next) {
      slopeMap?.dispose();
      slopeMap = toTexture(next);
      applyLayer();
    },

    setLayer(next) {
      layer = next;
      applyLayer();
    },

    setContours(on) {
      terrainUniforms.uContours.value = on ? 1 : 0;
    },

    setGround(surface, secondary) {
      const changed = surface !== groundSurface;
      groundSurface = surface;
      groundSecond = secondary;
      applyGround();
      if (changed) rebuildCamp();
      for (const name of [surface, secondary]) {
        if (!name || grounds.has(name)) continue;
        fetchGround(name)
          .then(applyGround)
          .catch(() => undefined);
      }
    },

    setWet(on) {
      wet = on;
      terrainUniforms.uWet.value = on ? 1 : 0;
      // Mojado, el suelo refleja el cielo.
      terrainMaterial.envMapIntensity = on ? 0.6 : 0;
      trackMaterial.roughness = on ? 0.55 : 0.96;
    },

    setQuality(next) {
      if (next === quality) return;
      quality = next;
      applyQuality();
      applyGround();
    },

    setRobot(next, nextShape) {
      if (robot) {
        holder.remove(robot.root);
        robot.dispose();
      }
      robot = next;
      shape = nextShape;
      holder.add(next.root);
      next.lights(1 - daylight);
      headlight.position.copy(next.lamp);
      headlight.target.position.set(next.lamp.x + 10, next.lamp.y - 2.2, 0);
      underShadow.scale.set(nextShape.body.length * 1.75, 1, nextShape.body.width * 1.75);
    },

    setPose(pose) {
      if (!shape) return;
      const { wheelbase: L, track: T } = shape.body;
      // Izquierda de la dirección de avance, en (este, norte).
      const lx = -pose.dy;
      const ly = pose.dx;
      const ground = (along: number, side: number) =>
        heightAt(pose.east + pose.dx * along + lx * side, pose.north + pose.dy * along + ly * side);
      const fl = ground(L / 2, T / 2);
      const fr = ground(L / 2, -T / 2);
      const rl = ground(-L / 2, T / 2);
      const rr = ground(-L / 2, -T / 2);
      holder.position.set(pose.east, (fl + fr + rl + rr) / 4 - base - pose.sinkage, -pose.north);
      heading = Math.atan2(pose.dy, pose.dx);
      holder.rotation.set(Math.atan2((fl + rl - fr - rr) / 2, T), heading, Math.atan2((fl + fr - rl - rr) / 2, L));
      robot?.spin(pose.wheelAngle);
      underShadow.position.y = pose.sinkage + 0.035;
      const moved = holder.position.clone().sub(robotPosition);
      const jumped = moved.lengthSq() > 25;
      robotPosition.copy(holder.position);
      // La cámara acompaña al robot; un salto grande (otro punto de partida) no la arrastra a medias.
      controls.target.add(moved);
      camera.position.add(moved);
      placeWindow(pose.east, pose.north);

      // Polvo: lo levantan las ruedas traseras al avanzar y, más aún, al patinar.
      const spun = Math.abs(pose.wheelAngle - lastWheelAngle) * shape.wheelRadius;
      lastWheelAngle = pose.wheelAngle;
      lastSlip = pose.slip ?? lastSlip;
      if (jumped || calm || wet || raining || spun <= 0) return;
      dustDebt += Math.min(1.5, spun) * (2.2 + 9 * lastSlip) * (quality === "alta" ? 1 : 0.5);
      const forward = new Vector3(Math.cos(heading), 0, -Math.sin(heading));
      const sideways = new Vector3(Math.sin(heading), 0, Math.cos(heading));
      while (dustDebt >= 1) {
        dustDebt -= 1;
        const side = dustNext % 2 ? 1 : -1;
        const spot = holder.position.clone().addScaledVector(forward, -L / 2 - 0.1).addScaledVector(sideways, (side * T) / 2);
        spot.y += pose.sinkage + 0.08;
        const k = dustNext * 3;
        dustPositions.set([spot.x + (Math.random() - 0.5) * 0.2, spot.y, spot.z + (Math.random() - 0.5) * 0.2], k);
        dustVelocities.set(
          [-forward.x * 0.35 + (Math.random() - 0.5) * 0.5, 0.35 + Math.random() * 0.75, -forward.z * 0.35 + (Math.random() - 0.5) * 0.5],
          k,
        );
        dustLives.set([dustUniforms.uTime.value, 1.5 + Math.random() * 1.6], dustNext * 2);
        dustNext = (dustNext + 1) % DUST_COUNT;
      }
      dustGeometry.attributes.position.needsUpdate = true;
      dustGeometry.attributes.aVelocity.needsUpdate = true;
      dustGeometry.attributes.aLife.needsUpdate = true;
    },

    setTarget(target) {
      flag.visible = Boolean(target);
      if (target) flag.position.copy(toWorld(target.east, target.north));
    },

    addTrack(pose, slipColor) {
      if (!shape) return;
      const half = shape.body.track / 2;
      const lx = -pose.dy;
      const ly = pose.dx;
      const left = toWorld(pose.east + lx * half, pose.north + ly * half);
      const right = toWorld(pose.east - lx * half, pose.north - ly * half);
      if (lastTrack) {
        const halfWidth = shape.wheelWidth / 2;
        // El cordón de tierra que la rueda aparta sube con lo que se hunde: así el surco se ve hondo.
        const berm = Math.min(0.07, Math.max(0.006, pose.sinkage * 0.55));
        const reach = halfWidth + Math.max(0.05, shape.wheelWidth * 0.45);
        const step = Math.hypot(left.x - lastTrack.left.x, left.z - lastTrack.left.z);
        const v0 = trackLength / TREAD_M;
        const v1 = (trackLength + step) / TREAD_M;
        trackLength += step;
        // Colores: el fondo, del tono del suelo y más oscuro cuanto más hondo; los cordones, más claros.
        const depth = Math.min(1, pose.sinkage / 0.12);
        // Los colores de los vértices van en luz lineal: los de pantalla (sRGB) se convierten.
        const linear = (value: number) => Math.pow(Math.min(1, Math.max(0, value)), 2.2);
        const soil = tintNear(pose.east, pose.north);
        const bottom = soil.map((value) => linear(value * (0.62 - 0.2 * depth)));
        const ridge = soil.map((value) => linear(Math.min(1, value * 1.06 + 0.03)));
        const slipBottom = slipColor.map((value) => linear(value * TRACK_SHADE));
        const slipRidge = slipColor.map((value) => linear(value));
        // Vector lateral en la escena (x, z) y normales de los cordones, que caen hacia fuera.
        const sx = lx;
        const sz = -ly;
        const tilt = berm / (reach - halfWidth);
        const start = trackNext * TRACK_VERTS;
        let vertex = start;
        const put = (point: Vector3, offsetSide: number, lift: number, normal: readonly [number, number, number], uv: readonly [number, number], colorA: readonly number[], colorB: readonly number[]) => {
          trackPositions.set([point.x + sx * offsetSide, point.y + lift, point.z + sz * offsetSide], vertex * 3);
          trackNormals.set(normal, vertex * 3);
          trackUvs.set(uv, vertex * 2);
          rutColors.set(colorA, vertex * 3);
          slipColors.set(colorB, vertex * 3);
          vertex++;
        };
        for (const [from, to] of [
          [lastTrack.left, left],
          [lastTrack.right, right],
        ] as const) {
          // Tres cintas: cordón, fondo y cordón. Cada una, dos triángulos.
          const strips = [
            { a: -reach, b: -halfWidth, liftA: 0.012, liftB: 0.012 + berm, normal: [-sx * tilt, 1, -sz * tilt] as const, uA: 0.62, uB: 0.9, colors: [ridge, slipRidge] as const },
            { a: -halfWidth, b: halfWidth, liftA: 0.016, liftB: 0.016, normal: [0, 1, 0] as const, uA: 0.02, uB: 0.48, colors: [bottom, slipBottom] as const },
            { a: halfWidth, b: reach, liftA: 0.012 + berm, liftB: 0.012, normal: [sx * tilt, 1, sz * tilt] as const, uA: 0.9, uB: 0.62, colors: [ridge, slipRidge] as const },
          ];
          for (const strip of strips) {
            const corners = [
              [from, strip.a, strip.liftA, strip.uA, v0],
              [from, strip.b, strip.liftB, strip.uB, v0],
              [to, strip.a, strip.liftA, strip.uA, v1],
              [from, strip.b, strip.liftB, strip.uB, v0],
              [to, strip.b, strip.liftB, strip.uB, v1],
              [to, strip.a, strip.liftA, strip.uA, v1],
            ] as const;
            for (const [point, offsetSide, lift, u, v] of corners) put(point, offsetSide, lift, strip.normal, [u, v], strip.colors[0], strip.colors[1]);
          }
        }
        const from3 = start * 3;
        const to3 = vertex * 3;
        trackColors.set((trackStyle === "surco" ? rutColors : slipColors).subarray(from3, to3), from3);
        // Al llenarse, las huellas más viejas se borran.
        trackNext = (trackNext + 1) % TRACK_CAPACITY;
        trackCount = Math.min(TRACK_CAPACITY, trackCount + 1);
        trackGeometry.setDrawRange(0, trackCount * TRACK_VERTS);
        for (const name of ["position", "normal", "uv", "color"] as const) trackGeometry.attributes[name].needsUpdate = true;
      }
      lastTrack = { left, right };
    },

    setTrackStyle(style) {
      trackStyle = style;
      paintTracks();
    },

    clearTrack() {
      trackCount = 0;
      trackNext = 0;
      trackLength = 0;
      lastTrack = null;
      trackGeometry.setDrawRange(0, 0);
    },

    setCamp(layout, rocksOn) {
      campLayout = layout;
      campRocksOn = rocksOn;
      rebuildCamp();
    },

    setSky(state) {
      const palette = skyPalette(state);
      const set = (color: Color, rgb: RGB) => color.setRGB(rgb[0], rgb[1], rgb[2], "srgb");
      set(skyUniforms.uZenith.value, palette.zenith);
      set(skyUniforms.uHorizon.value, palette.horizon);
      set(skyUniforms.uSunColor.value, palette.sun);
      set(skyUniforms.uCloudLight.value, palette.cloudLight);
      set(skyUniforms.uCloudDark.value, palette.cloudDark);
      skyUniforms.uCloud.value = state.cloud;
      skyUniforms.uSunDisc.value = palette.sunDisc;
      skyUniforms.uStars.value = palette.stars;
      // El viento mueve las nubes: despacio, pero se nota.
      skyUniforms.uWind.value.set(state.windEast, -state.windNorth).multiplyScalar(0.002 + state.windSpeed * 0.0012);

      const elevation = (Math.max(state.elevation, 2) * Math.PI) / 180;
      const azimuth = (state.azimuth * Math.PI) / 180;
      sunDirection.set(Math.cos(elevation) * Math.sin(azimuth), Math.sin(elevation), -Math.cos(elevation) * Math.cos(azimuth)).normalize();
      set(sun.color, palette.sun);
      sun.intensity = palette.sunIntensity;
      hemisphere.intensity = palette.skyIntensity;
      set(hemisphere.color, [0, 1, 2].map((k) => (palette.zenith[k] + palette.horizon[k] * 2) / 3) as RGB);
      // La luz que rebota en el suelo tiene su color.
      set(hemisphere.groundColor, [0, 1, 2].map((k) => tint[k] * 0.55 + palette.horizon[k] * 0.12) as RGB);
      moon.intensity = (1 - palette.day) * 0.35;
      headlight.intensity = (1 - palette.day) * 900;
      set(fog.color, palette.horizon);
      fogDensity = palette.fogDensity;
      daylight = palette.day;
      overcast = Math.max(state.cloud, state.fog);
      raining = state.precipitation !== "ninguna";
      windSpeed = state.windSpeed;
      wind.set(state.windEast, 0, -state.windNorth).multiplyScalar(Math.min(6, state.windSpeed));
      dustUniforms.uWind.value.copy(wind).multiplyScalar(0.5);
      dustUniforms.uOpacity.value = 0.14 + 0.2 * palette.day;
      robot?.lights(1 - palette.day);
      camp?.setLight(1 - palette.day, overcast);
      (underShadow.material as MeshBasicMaterial).opacity = 0.22 + 0.26 * overcast + 0.1 * (1 - palette.day);

      const falling = raining && !calm;
      rain.visible = falling && state.precipitation === "lluvia";
      snow.visible = falling && state.precipitation === "nieve";
      // El viento inclina la caída: la lluvia cae a 9 m/s; la nieve, a poco más de 1 m/s.
      const drift = state.precipitation === "nieve" ? 0.8 : 0.35;
      fallUniforms.uFall.value.set(state.windEast * state.windSpeed * drift, state.precipitation === "nieve" ? -1.3 : -9, -state.windNorth * state.windSpeed * drift);
      fallUniforms.uStreak.value = state.precipitation === "nieve" ? 0 : 0.045;
      fallUniforms.uOpacity.value = (state.precipitation === "nieve" ? 0.9 : 0.42) * (0.45 + 0.55 * state.intensity) * (0.35 + 0.65 * palette.day);
      fallUniforms.uSize.value = state.precipitation === "nieve" ? 5 : 1;
      fallGeometry.setDrawRange(0, Math.round(FALL_COUNT * (0.3 + 0.7 * state.intensity)) * 2);

      reflection?.dispose();
      reflection = pmrem.fromScene(reflectionScene, 0, 1, 5000);
      scene.environment = reflection.texture;
    },

    setCamera(mode) {
      const wasOnboard = cameraMode === "robot";
      cameraMode = mode;
      const size = robotSize();
      const back = new Vector3(-Math.cos(heading), 0, Math.sin(heading));
      const onboardNow = mode === "robot";
      controls.enabled = !onboardNow;
      if (onboardNow !== wasOnboard) {
        viewFov = onboardNow ? FOV_ONBOARD : FOV;
        applyView();
      }
      if (onboardNow) {
        look = { yaw: 0, pitch: -0.2 };
        onboard();
        return;
      }
      if (mode === "seguir") {
        // Detrás y bien por encima, mirando al suelo de delante: el robot queda abajo y el camino, en el centro.
        const rig = chaseRig(size);
        controls.target.copy(aheadPoint(desired));
        camera.position.copy(robotPosition).addScaledVector(back, rig.back).add(new Vector3(0, rig.up, 0));
      } else {
        const target = robotPosition.clone().add(new Vector3(0, size * 0.5, 0));
        controls.target.copy(target);
        if (mode === "libre") camera.position.copy(target).addScaledVector(back, size * 2.4 + 2.4).add(new Vector3(size * 1.2 + 1, size * 0.7 + 0.8, size * 0.6));
        else if (mode === "cenital") camera.position.copy(target).add(new Vector3(0, 55, 0)).addScaledVector(back, 0.5);
        else camera.position.copy(target).add(new Vector3(-areaSize * 0.34, areaSize * 0.3, areaSize * 0.42));
      }
      lastInteraction = -Infinity;
      controls.update();
    },

    setInsets(top, bottom) {
      if (Math.abs(top - insetTop) < 1 && Math.abs(bottom - insetBottom) < 1) return;
      insetTop = top;
      insetBottom = bottom;
      applyView();
    },

    dispose() {
      disposed = true;
      cancelAnimationFrame(frameId);
      observer.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onDown);
      renderer.domElement.removeEventListener("pointermove", onMove);
      renderer.domElement.removeEventListener("pointerup", onUp);
      renderer.domElement.removeEventListener("pointercancel", onCancel);
      renderer.domElement.removeEventListener("pointerleave", onCancel);
      controls.removeEventListener("start", onControlStart);
      controls.removeEventListener("end", onControlEnd);
      controls.dispose();
      satellite?.dispose();
      slopeMap?.dispose();
      detail.dispose();
      tread.dispose();
      shadowMap.dispose();
      reflection?.dispose();
      pmrem.dispose();
      robot?.dispose();
      camp?.dispose();
      for (const loaded of grounds.values()) {
        loaded.color.dispose();
        loaded.normal.dispose();
      }
      grounds.clear();
      for (const root of [scene, reflectionScene]) {
        root.traverse((node) => {
          const mesh = node as Mesh;
          mesh.geometry?.dispose();
          const material = mesh.material as { dispose?: () => void } | { dispose?: () => void }[] | undefined;
          if (Array.isArray(material)) material.forEach((m) => m.dispose?.());
          else material?.dispose?.();
        });
      }
      sun.shadow.map?.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    },
  };

  const observer = new ResizeObserver(applyView);
  observer.observe(container);
  applyQuality();
  // La fotografía de roca se pide ya: las rocas la estrenan en cuanto llega.
  fetchGround("bloque")
    .then(rebuildCamp)
    .catch(() => undefined);

  let last = performance.now();
  let clock = 0;
  let frameId = 0;
  // Para saber si la imagen va fluida: media de los últimos cuadros, pasado el arranque.
  let slowFrames = 0;
  let measured = 0;
  let warned = false;
  const frame = (now: number) => {
    const elapsed = (now - last) / 1000;
    const dt = Math.min(0.1, elapsed);
    last = now;
    if (!calm) clock += dt;
    dustUniforms.uTime.value += dt;
    api.onFrame?.(dt);
    if (cameraMode === "robot") onboard();
    else {
      chase(dt, now);
      controls.update();
      // La cámara no se mete bajo el suelo.
      const ground = heightAt(camera.position.x, -camera.position.z) - base + 0.5;
      if (camera.position.y < ground) camera.position.y = ground;
    }

    const distance = cameraMode === "robot" ? 2 : camera.position.distanceTo(controls.target);
    // De lejos el plano cercano se aleja: mejora la precisión de la profundidad.
    const near = cameraMode === "robot" ? 0.08 : Math.min(60, Math.max(0.25, distance * 0.04));
    if (Math.abs(camera.near - near) > near * 0.2) {
      camera.near = near;
      camera.updateProjectionMatrix();
    }
    // Con la cámara lejos (vista del área) la neblina se aclara lo justo para que el paisaje no
    // desaparezca: de cerca, la niebla o la lluvia tapan a la distancia real.
    fog.density = Math.min(fogDensity, 0.5 / Math.max(distance, 1));
    sky.position.copy(camera.position);
    skyUniforms.uTime.value = clock;
    fallUniforms.uTime.value = clock;
    dustUniforms.uScale.value = renderer.domElement.height * 0.55;
    camp?.update(clock, windSpeed);
    // La sombra del Sol sigue al robot a saltos de un metro: así no tiembla al avanzar.
    const anchor = desired.set(Math.round(robotPosition.x), robotPosition.y, Math.round(robotPosition.z));
    sun.position.copy(anchor).addScaledVector(sunDirection, 140);
    sun.target.position.copy(anchor);

    // Señales altas sobre el robot y la bandera: de lejos no se verían.
    for (const [beacon, spot, visible] of [
      [robotBeacon, robotPosition, cameraMode !== "robot"],
      [flagBeacon, flag.position, flag.visible],
    ] as const) {
      const away = camera.position.distanceTo(spot);
      beacon.visible = visible && away > 90;
      if (beacon.visible) {
        const tall = away * 0.1;
        beacon.scale.set(away / 260, tall, away / 260);
        beacon.position.set(spot.x, spot.y + 3 + tall / 2, spot.z);
      }
    }
    renderer.render(scene, camera);

    // Si con la calidad alta va a trompicones varios segundos seguidos, se avisa una vez.
    if (!warned && quality === "alta" && now > 6000 && document.visibilityState === "visible") {
      measured++;
      if (elapsed > 1 / 20) slowFrames++;
      if (measured >= 120) {
        if (slowFrames > 80) {
          warned = true;
          api.onSlow?.();
        }
        measured = 0;
        slowFrames = 0;
      }
    }
    frameId = requestAnimationFrame(frame);
  };
  frameId = requestAnimationFrame(frame);
  // En un equipo que dibuja sin tarjeta gráfica no hace falta esperar: se pide la calidad media ya.
  if (software && quality === "alta") queueMicrotask(() => api.onSlow?.());

  return api;
}
