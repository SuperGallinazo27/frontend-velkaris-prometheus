/**
 * Piezas compartidas por las escenas 3D: cielo de galaxia, estrellas, halo de atmósfera y ruido procedural.
 * Las usan la portada (features/landing) y el mundo interactivo (features/world).
 * Todo se genera por código: no hay imágenes ni texturas descargadas.
 */
import {
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  CubeCamera,
  Mesh,
  Points,
  SRGBColorSpace,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
  WebGLCubeRenderTarget,
} from "three";
import type { CubeTexture, WebGLRenderer } from "three";

export const SUN = new Vector3(-0.55, 0.4, 0.73).normalize();
export const BACKGROUND = "#070f0d";

/** Color sRGB tal cual, para los shaders propios (que escriben directo a pantalla). */
export function rgb(hex: string): Vector3 {
  const n = parseInt(hex.slice(1), 16);
  return new Vector3(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

/** Generador pseudoaleatorio con semilla: la escena es idéntica en cada carga. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const NOISE = /* glsl */ `
  float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float noise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x),
          mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
      mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x),
          mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y),
      f.z);
  }
  float fbm(vec3 p) {
    float amp = 0.5;
    float sum = 0.0;
    for (int i = 0; i < 5; i++) {
      sum += amp * noise(p);
      p = p * 2.02 + vec3(1.7, 9.2, 3.1);
      amp *= 0.5;
    }
    return sum;
  }
`;

export const PLANET_VERTEX = /* glsl */ `
  varying vec3 vObj;
  varying vec3 vNw;
  varying vec3 vPw;
  void main() {
    vObj = position;
    vNw = normalize(mat3(modelMatrix) * normal);
    vec4 world = modelMatrix * vec4(position, 1.0);
    vPw = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

/** Halo de atmósfera: cascarón visto por dentro, más intenso junto al borde del planeta. */
export const HALO_VERTEX = /* glsl */ `
  varying vec3 vNv;
  varying vec3 vPv;
  varying vec3 vNw;
  void main() {
    vNv = normalize(normalMatrix * normal);
    vNw = normalize(mat3(modelMatrix) * normal);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vPv = mv.xyz;
    gl_Position = projectionMatrix * mv;
  }
`;
export const HALO_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uSun;
  uniform float uEdge;
  uniform float uStrength;
  varying vec3 vNv;
  varying vec3 vPv;
  varying vec3 vNw;
  void main() {
    vec3 V = normalize(-vPv);
    float d = clamp(-dot(normalize(vNv), V) / uEdge, 0.0, 1.0);
    float lit = smoothstep(-0.45, 0.35, dot(normalize(vNw), uSun));
    gl_FragColor = vec4(uColor, pow(d, 3.0) * (0.12 + 0.88 * lit) * uStrength);
  }
`;

export const DOTS_VERTEX = /* glsl */ `
  attribute float aSize;
  attribute float aPhase;
  attribute vec3 aColor;
  uniform float uTime;
  uniform float uPx;
  uniform float uAtten;
  uniform float uTwinkle;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    float size = aSize * uPx;
    if (uAtten > 0.0) size *= uAtten / -mv.z;
    gl_PointSize = size;
    vAlpha = 1.0 - uTwinkle * 0.6 * (0.5 + 0.5 * sin(uTime * (0.5 + aPhase) + aPhase * 50.0));
    vColor = aColor;
  }
`;
export const DOTS_FRAGMENT = /* glsl */ `
  uniform float uOpacity;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.0, d);
    gl_FragColor = vec4(vColor, a * a * vAlpha * uOpacity);
  }
`;

/** Cielo: banda tipo Vía Láctea con nubes, franjas de polvo y polvo de estrellas, sobre el fondo oscuro. */
export const SKY_VERTEX = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
export const SKY_FRAGMENT = /* glsl */ `
  varying vec3 vDir;
  ${NOISE}
  void main() {
    vec3 d = normalize(vDir);
    // Plano de la banda: cruza en diagonal la dirección hacia la que mira casi todo el recorrido.
    float h = dot(d, normalize(vec3(0.55, 0.8, -0.2)));
    float band = exp(-h * h * 9.0);
    float clouds = fbm(d * 2.4 + 4.0);
    float fine = fbm(d * 6.0 - 2.0);
    float dust = smoothstep(0.42, 0.7, fbm(d * 4.2 + vec3(9.0, 1.0, 5.0)));

    vec3 col = vec3(0.027, 0.059, 0.051);
    col += vec3(0.10, 0.20, 0.19) * band * (0.35 + 0.65 * clouds) * 0.9;
    col += vec3(0.30, 0.14, 0.08) * band * band * smoothstep(0.42, 0.72, fine) * 0.95;
    col += vec3(0.22, 0.20, 0.16) * pow(band, 3.0) * clouds * 0.85;
    col *= 1.0 - 0.6 * dust * band;

    // Nubes sueltas fuera de la banda
    float away = 1.0 - band;
    col += vec3(0.05, 0.10, 0.10) * smoothstep(0.5, 0.8, fbm(d * 1.6 + 20.0)) * away * 0.8;
    col += vec3(0.10, 0.05, 0.03) * smoothstep(0.55, 0.85, fbm(d * 1.9 + 31.0)) * away * 0.5;

    // Polvo de estrellas, más denso dentro de la banda
    vec3 q = d * 240.0;
    vec3 cell = floor(q);
    float chance = 0.006 + 0.05 * band * (1.0 - 0.7 * dust);
    float star = step(1.0 - chance, hash(cell)) * smoothstep(0.32, 0.0, length(fract(q) - 0.5));
    col += vec3(1.0, 0.95, 0.88) * star * (0.35 + 0.65 * hash(cell + 3.1));
    // La textura del cielo se guarda en sRGB: se entrega el color en lineal para que llegue a pantalla tal cual.
    gl_FragColor = vec4(pow(col, vec3(2.2)), 1.0);
  }
`;

/** Dibuja el cielo una sola vez en una textura cúbica: después no cuesta nada por fotograma. */
export function buildSky(renderer: WebGLRenderer, size: number): { texture: CubeTexture; dispose: () => void } {
  const target = new WebGLCubeRenderTarget(size);
  target.texture.colorSpace = SRGBColorSpace;
  const dome = new Mesh(
    new SphereGeometry(10, 48, 32),
    new ShaderMaterial({ vertexShader: SKY_VERTEX, fragmentShader: SKY_FRAGMENT, side: BackSide, depthWrite: false }),
  );
  const skyScene = new Scene();
  skyScene.add(dome);
  new CubeCamera(0.1, 100, target).update(renderer, skyScene);
  dome.geometry.dispose();
  dome.material.dispose();
  return { texture: target.texture, dispose: () => target.dispose() };
}

export function dotsMaterial(px: number, atten: number, twinkle: number, opacity: number): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: DOTS_VERTEX,
    fragmentShader: DOTS_FRAGMENT,
    uniforms: {
      uTime: { value: 0 },
      uPx: { value: px },
      uAtten: { value: atten },
      uTwinkle: { value: twinkle },
      uOpacity: { value: opacity },
    },
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
}

export function dotsGeometry(positions: Float32Array, colors: Float32Array, sizes: Float32Array, phases: Float32Array) {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setAttribute("aColor", new BufferAttribute(colors, 3));
  geometry.setAttribute("aSize", new BufferAttribute(sizes, 1));
  geometry.setAttribute("aPhase", new BufferAttribute(phases, 1));
  return geometry;
}

export function buildStars(count: number, px: number): Points {
  const rand = mulberry32(7);
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const phases = new Float32Array(count);
  const tints = [rgb("#fff6e8"), rgb("#ffd9bd"), rgb("#c9f1e6"), rgb("#ffffff")];
  for (let i = 0; i < count; i++) {
    const z = rand() * 2 - 1;
    const angle = rand() * Math.PI * 2;
    const ring = Math.sqrt(1 - z * z);
    const radius = 170 + rand() * 160;
    positions[i * 3] = 4.5 + Math.cos(angle) * ring * radius;
    positions[i * 3 + 1] = z * radius;
    positions[i * 3 + 2] = -13 + Math.sin(angle) * ring * radius;
    const tint = tints[Math.floor(rand() * tints.length)];
    const brightness = 0.6 + rand() * 0.4;
    colors[i * 3] = tint.x * brightness;
    colors[i * 3 + 1] = tint.y * brightness;
    colors[i * 3 + 2] = tint.z * brightness;
    sizes[i] = rand() < 0.07 ? 3.4 + rand() * 1.6 : 1.5 + rand() * 1.5;
    phases[i] = rand();
  }
  const stars = new Points(dotsGeometry(positions, colors, sizes, phases), dotsMaterial(px, 0, 1, 1));
  stars.frustumCulled = false;
  return stars;
}

export function buildHalo(radius: number, scale: number, color: string, strength: number): Mesh {
  const material = new ShaderMaterial({
    vertexShader: HALO_VERTEX,
    fragmentShader: HALO_FRAGMENT,
    uniforms: {
      uColor: { value: rgb(color) },
      uSun: { value: SUN },
      uEdge: { value: Math.sqrt(1 - 1 / (scale * scale)) },
      uStrength: { value: strength },
    },
    side: BackSide,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  return new Mesh(new SphereGeometry(radius * scale, 64, 48), material);
}
