/**
 * Escena 3D de la portada: la Tierra, la Luna, Marte, un cielo de galaxia y una sonda que
 * hace el viaje Tierra → Luna → Marte → Tierra siguiendo el scroll.
 *
 * La Tierra y Marte se dibujan por código (ruido procedural y contornos esquemáticos). La Luna
 * usa el relieve real medido por el láser LOLA de NASA (luna-lola.webp, generado por
 * scripts/luna/calcular.py); mientras carga, o si falla, queda la versión dibujada. Este módulo
 * se carga con import() dinámico para que Three.js no pese en el arranque ni en el resto de la aplicación.
 */
import {
  AdditiveBlending,
  AmbientLight,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Group,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  Points,
  QuadraticBezierCurve3,
  Quaternion,
  RepeatWrapping,
  RingGeometry,
  SRGBColorSpace,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  TextureLoader,
  Vector3,
  WebGLRenderer,
} from "three";
import type { Material, Object3D, Texture } from "three";
import type { RankedSite, Terrain } from "../../types/analysis";
import {
  BACKGROUND,
  NOISE,
  PLANET_VERTEX,
  SUN,
  buildHalo,
  buildSky,
  buildStars,
  dotsGeometry,
  dotsMaterial,
  mulberry32,
  rgb,
} from "../../three/space";
import { continents } from "./continents";
import moonReliefUrl from "./luna-lola.webp";
import {
  EARTH_CENTER,
  MARS_CENTER,
  MOON_CENTER,
  SHOTS,
  faceOf,
  latLonToVec3,
  marsLegT,
  moonLegT,
  sampleShots,
  shortestAngle,
  smoothstep,
  travelT,
  yawFacing,
} from "./journey";
import type { Vec3 } from "./journey";

export interface SceneOptions {
  /** Contenedor donde se inserta el canvas. */
  host: HTMLElement;
  /** Contenedor de las etiquetas HTML que siguen a los marcadores. */
  labels: HTMLElement;
  /** Escenarios de referencia de la Luna y de Marte. */
  regions: readonly Terrain[];
  /** Candidatos terrestres. */
  candidates: readonly Terrain[];
  /** Sin animación ambiental; la cámara salta de capítulo en capítulo. */
  calm: boolean;
  onContextLost: () => void;
}

export interface SceneHandle {
  setProgress(p: number): void;
  /** Escenario elegido en cada mundo y ranking de candidatos frente a la referencia vigente. */
  setSelection(moonId: string, marsId: string, ranking: readonly RankedSite[]): void;
  setCalm(calm: boolean): void;
  dispose(): void;
}

const MARS_RADIUS = 1;
const EARTH_RADIUS = 1.15;
const MOON_RADIUS = 0.42;
/** Punto de la Tierra que mira a la cámara en el capítulo de candidatos cuando aún no hay ranking. */
const EARTH_FACE = { lat: 25, lon: -62 };

/** Planeta rocoso: cuatro tonos mezclados con ruido, casquetes opcionales y bruma en el limbo. */
const ROCKY_FRAGMENT = /* glsl */ `
  uniform vec3 uSun;
  uniform vec3 uDark;
  uniform vec3 uMid;
  uniform vec3 uMain;
  uniform vec3 uLight;
  uniform vec3 uIce;
  uniform vec3 uHaze;
  uniform float uCaps;
  uniform float uSeed;
  uniform float uReveal;
  uniform float uCraters;
  uniform sampler2D uMap;
  uniform float uUseMap;
  varying vec3 vObj;
  varying vec3 vNw;
  varying vec3 vPw;
  ${NOISE}
  // Distancia al cráter más cercano medida en radios de ese cráter: menor que 1 es su interior.
  float craterField(vec3 p) {
    vec3 cell = floor(p);
    vec3 f = fract(p);
    float nearest = 4.0;
    for (int x = -1; x <= 1; x++) {
      for (int y = -1; y <= 1; y++) {
        for (int z = -1; z <= 1; z++) {
          vec3 g = vec3(float(x), float(y), float(z));
          vec3 id = cell + g;
          vec3 centre = g + vec3(hash(id), hash(id + 7.3), hash(id + 13.7));
          float radius = 0.16 + 0.26 * hash(id + 21.1);
          nearest = min(nearest, length(centre - f) / radius);
        }
      }
    }
    return nearest;
  }
  // Fondo más oscuro y borde más claro.
  float craterShade(float d) {
    float bowl = 1.0 - smoothstep(0.0, 0.85, d);
    float rim = smoothstep(0.8, 1.0, d) * (1.0 - smoothstep(1.0, 1.3, d));
    return 1.0 - 0.3 * bowl + 0.22 * rim;
  }
  void main() {
    vec3 N = normalize(vNw);
    vec3 V = normalize(cameraPosition - vPw);
    vec3 p = normalize(vObj) + uSeed;
    float base = fbm(p * 2.1 + 3.7);
    float detail = fbm(p * 7.5 - 1.3);
    float maria = smoothstep(0.46, 0.62, fbm(p * 1.25 + vec3(11.0, 4.0, 7.0)));
    vec3 c = mix(uMid, uMain, smoothstep(0.3, 0.7, base));
    c = mix(c, uLight, smoothstep(0.5, 0.8, detail) * 0.55);
    c = mix(c, uDark, maria * 0.72);
    c *= 0.86 + 0.28 * detail;
    if (uCraters > 0.0) {
      float shade = craterShade(craterField(p * 3.5)) * mix(1.0, craterShade(craterField(p * 8.0 + 3.0)), 0.6);
      c *= mix(1.0, shade, uCraters);
    }
    if (uUseMap > 0.5) {
      // Relieve real: textura equirrectangular, longitud de −180 a 180 y norte arriba.
      vec3 n = normalize(vObj);
      float lon = atan(-n.z, n.x);
      float lat = asin(clamp(n.y, -1.0, 1.0));
      // Dos coordenadas con la costura en meridianos distintos; se usa la que no salta aquí,
      // para que no aparezca una línea en el meridiano 180.
      float uA = lon / 6.2831853 + 0.5;
      float uB = fract(lon / 6.2831853 + 1.0) + 0.5;
      float u = fwidth(uA) <= fwidth(uB) ? uA : uB;
      c = texture2D(uMap, vec2(u, lat / 3.14159265 + 0.5)).rgb;
    }
    float cap = smoothstep(0.87, 0.93, abs(normalize(vObj).y) + (detail - 0.5) * 0.09);
    c = mix(c, uIce, cap * uCaps);
    float day = smoothstep(-0.12, 0.55, dot(N, uSun));
    vec3 col = c * (0.035 + day * 1.05);
    float fres = pow(1.0 - max(dot(N, V), 0.0), 2.6);
    col += uHaze * fres * (0.12 + day) * 0.55;
    gl_FragColor = vec4(mix(vec3(0.027, 0.059, 0.051), col, uReveal), 1.0);
  }
`;

const EARTH_FRAGMENT = /* glsl */ `
  uniform sampler2D uMask;
  uniform vec3 uSun;
  uniform float uTime;
  uniform float uReveal;
  varying vec3 vObj;
  varying vec3 vNw;
  varying vec3 vPw;
  ${NOISE}
  void main() {
    vec3 N = normalize(vNw);
    vec3 V = normalize(cameraPosition - vPw);
    vec3 p = normalize(vObj);
    float lon = atan(-p.z, p.x);
    float lat = asin(clamp(p.y, -1.0, 1.0));
    vec2 uv = vec2(lon / 6.2831853 + 0.5, lat / 3.14159265 + 0.5);
    float wobble = fbm(p * 9.0);
    vec2 jitter = (vec2(fbm(p * 14.0 + 5.0), wobble) - 0.5) * 0.012;
    float mask = texture2D(uMask, uv + jitter).r;
    float land = smoothstep(0.42, 0.58, mask);
    float shelf = smoothstep(0.1, 0.5, mask);

    float absLat = abs(p.y);
    float arid = (1.0 - smoothstep(0.0, 0.24, abs(absLat - 0.42))) * smoothstep(0.34, 0.56, fbm(p * 3.0 + 2.0));
    float cold = smoothstep(0.7, 0.9, absLat);
    vec3 landColor = mix(vec3(0.118, 0.298, 0.212), vec3(0.290, 0.478, 0.298), fbm(p * 5.0));
    landColor = mix(landColor, vec3(0.741, 0.592, 0.380), arid * 0.9);
    landColor = mix(landColor, vec3(0.592, 0.631, 0.588), cold * 0.75);
    vec3 seaColor = mix(vec3(0.027, 0.153, 0.227), vec3(0.071, 0.357, 0.427), shelf * 0.85);
    vec3 c = mix(seaColor, landColor, land);

    float ice = smoothstep(0.93, 0.97, absLat + (wobble - 0.5) * 0.05);
    ice = max(ice, land * smoothstep(0.88, 0.95, p.y));
    c = mix(c, vec3(0.84, 0.88, 0.88), ice);

    float a = uTime * 0.012;
    vec3 q = p;
    q.xz = mat2(cos(a), -sin(a), sin(a), cos(a)) * q.xz;
    float cloud = smoothstep(0.5, 0.72, fbm(q * 3.2 + vec3(0.0, uTime * 0.004, 0.0)));
    cloud *= 0.5 + 0.5 * fbm(q * 9.0);
    c = mix(c, vec3(0.95, 0.97, 0.96), cloud * 0.78);

    float day = smoothstep(-0.1, 0.5, dot(N, uSun));
    vec3 col = c * (0.03 + day * 1.08);
    vec3 H = normalize(uSun + V);
    float spec = pow(max(dot(N, H), 0.0), 60.0) * (1.0 - land) * (1.0 - cloud) * 0.5;
    col += vec3(1.0, 0.95, 0.85) * spec * day;
    float fres = pow(1.0 - max(dot(N, V), 0.0), 2.4);
    col += vec3(0.45, 0.85, 0.82) * fres * (0.1 + day) * 0.7;
    gl_FragColor = vec4(mix(vec3(0.027, 0.059, 0.051), col, uReveal), 1.0);
  }
`;

const PATH_VERTEX = /* glsl */ `
  attribute float aT;
  uniform float uPx;
  uniform float uHead;
  varying float vDone;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    vDone = step(aT, uHead);
    gl_PointSize = uPx * mix(2.2, 3.4, vDone) * clamp(9.0 / -mv.z, 0.6, 2.4);
  }
`;
const PATH_FRAGMENT = /* glsl */ `
  uniform float uOpacity;
  uniform vec3 uDone;
  uniform vec3 uAhead;
  varying float vDone;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.1, d);
    gl_FragColor = vec4(mix(uAhead, uDone, vDone), a * mix(0.4, 0.95, vDone) * uOpacity);
  }
`;

function buildGalaxy(count: number, px: number): { root: Group; disc: Points } {
  const rand = mulberry32(21);
  const gauss = () => (rand() + rand() + rand() + rand() - 2) / 2;
  const R = 38;
  const ARMS = 3;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const phases = new Float32Array(count);
  const core = rgb("#ffe9c9");
  const warm = rgb("#e58a5c");
  const cool = rgb("#4fb7a4");
  for (let i = 0; i < count; i++) {
    const t = Math.pow(rand(), 1.7);
    const r = t * R;
    const angle = ((i % ARMS) / ARMS) * Math.PI * 2 + t * 4.4 + gauss() * 0.3;
    positions[i * 3] = Math.cos(angle) * r + gauss() * (0.8 + r * 0.1);
    positions[i * 3 + 1] = gauss() * (2.6 * (1 - t) + 0.5);
    positions[i * 3 + 2] = Math.sin(angle) * r + gauss() * (0.8 + r * 0.1);
    const toWarm = smoothstep(0, 0.4, t);
    const toCool = smoothstep(0.35, 1, t);
    const brightness = 0.35 + rand() * 0.5;
    for (let k = 0; k < 3; k++) {
      const a = core.getComponent(k) + (warm.getComponent(k) - core.getComponent(k)) * toWarm;
      colors[i * 3 + k] = (a + (cool.getComponent(k) - a) * toCool) * brightness;
    }
    sizes[i] = 1 + rand() * 2.2;
    phases[i] = rand();
  }
  const disc = new Points(dotsGeometry(positions, colors, sizes, phases), dotsMaterial(px, 175, 0.5, 0.8));
  disc.frustumCulled = false;
  const root = new Group();
  root.position.set(-88, 46, -150);
  root.rotation.set(1.02, 0, 0.38);
  root.add(disc);
  return { root, disc };
}

/** Máscara de tierra firme en proyección equirrectangular, a partir de los contornos esquemáticos. */
function buildLandMask(): CanvasTexture {
  const W = 1024;
  const H = 512;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);
  ctx.filter = "blur(1.5px)";
  ctx.fillStyle = "#fff";
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 3;
  ctx.lineJoin = "round";
  for (const outline of continents) {
    ctx.beginPath();
    outline.forEach(([lon, lat], i) => {
      const x = ((lon + 180) / 360) * W;
      const y = ((90 - lat) / 180) * H;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  const texture = new CanvasTexture(canvas);
  texture.wrapS = RepeatWrapping;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.generateMipmaps = false;
  return texture;
}

interface Marker {
  id: string;
  root: Group;
  pulse: Mesh;
  materials: MeshBasicMaterial[];
  label: HTMLSpanElement;
  active: boolean;
}

function buildMarker(site: Terrain, radius: number, labels: HTMLElement): Marker {
  const root = new Group();
  const [x, y, z] = latLonToVec3(site.latitude, site.longitude, radius * 1.012);
  root.position.set(x, y, z);
  root.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), new Vector3(x, y, z).normalize());
  const material = () => new MeshBasicMaterial({ transparent: true, side: DoubleSide, depthWrite: false });
  const materials = [material(), material(), material()];
  const ring = new Mesh(new RingGeometry(0.02, 0.027, 48), materials[0]);
  const dot = new Mesh(new CircleGeometry(0.009, 24), materials[1]);
  const pulse = new Mesh(new RingGeometry(0.03, 0.034, 48), materials[2]);
  root.add(ring, dot, pulse);
  root.scale.setScalar(radius);
  const label = document.createElement("span");
  label.className = "lp-etiqueta";
  label.textContent = site.name;
  labels.append(label);
  return { id: site.id, root, pulse, materials, label, active: false };
}

/** Sonda esquemática: cuerpo hexagonal, antena y dos paneles solares. El eje +Z es la dirección de avance. */
function buildProbe(): { root: Group; glow: Mesh } {
  const root = new Group();
  const foil = new MeshStandardMaterial({ color: "#d9a25f", metalness: 0.55, roughness: 0.45 });
  const shell = new MeshStandardMaterial({ color: "#f1e6d2", metalness: 0.15, roughness: 0.6, side: DoubleSide });
  const cell = new MeshStandardMaterial({ color: "#1d5560", metalness: 0.4, roughness: 0.35, emissive: "#0a2a30" });
  const dark = new MeshStandardMaterial({ color: "#39312a", metalness: 0.3, roughness: 0.7 });

  const body = new Mesh(new CylinderGeometry(0.5, 0.5, 1, 6), foil);
  body.rotation.x = Math.PI / 2;
  const dish = new Mesh(new SphereGeometry(0.62, 28, 10, 0, Math.PI * 2, 0, Math.PI / 2.7), shell);
  dish.position.set(0, 1.05, 0.1);
  dish.rotation.x = Math.PI + 0.35;
  const mast = new Mesh(new CylinderGeometry(0.035, 0.035, 0.5, 8), dark);
  mast.position.set(0, 0.62, 0.08);
  const nozzle = new Mesh(new CylinderGeometry(0.16, 0.3, 0.28, 16), dark);
  nozzle.rotation.x = Math.PI / 2;
  nozzle.position.z = -0.62;
  root.add(body, dish, mast, nozzle);
  for (const side of [-1, 1]) {
    const strut = new Mesh(new CylinderGeometry(0.03, 0.03, 0.5, 8), dark);
    strut.rotation.z = Math.PI / 2;
    strut.position.x = side * 0.72;
    const panel = new Mesh(new BoxGeometry(1.5, 0.035, 0.62), cell);
    panel.position.x = side * 1.7;
    const frame = new Mesh(new BoxGeometry(0.03, 0.05, 0.66), shell);
    frame.position.x = side * 1.7;
    root.add(strut, panel, frame);
  }
  const glow = new Mesh(
    new SphereGeometry(0.2, 16, 12),
    new MeshBasicMaterial({ color: "#ffb48a", transparent: true, opacity: 0.85, blending: AdditiveBlending, depthWrite: false }),
  );
  glow.position.z = -0.85;
  root.add(glow);
  return { root, glow };
}

/** Un cuerpo con marcadores: gira libre y, en su capítulo, encara un punto hacia la cámara. */
interface Body {
  center: Vector3;
  radius: number;
  pivot: Group;
  spin: Group;
  markers: Marker[];
  yaw: number;
  idle: number;
  /** Velocidad del giro libre, en radianes por segundo. */
  drift: number;
  /** Inclinación cuando no está en foco. */
  rest: number;
}

export function createScene(options: SceneOptions): SceneHandle {
  const { host, labels } = options;
  const narrow = () => host.clientWidth < 860 || host.clientWidth < host.clientHeight * 1.1;
  const mobile = narrow() || /Mobi|Android|iPhone/i.test(navigator.userAgent);

  // Lanza un error si el navegador no puede crear el contexto WebGL: quien llama muestra la versión estática.
  const renderer = new WebGLRenderer({ antialias: !mobile, powerPreference: "high-performance" });
  const px = Math.min(window.devicePixelRatio || 1, mobile ? 1.5 : 2);
  renderer.setPixelRatio(px);
  renderer.setClearColor(new Color(BACKGROUND), 1);
  const canvas = renderer.domElement;
  canvas.setAttribute("aria-hidden", "true");
  host.append(canvas);

  const scene = new Scene();
  const camera = new PerspectiveCamera(45, 1, 0.05, 900);
  const sunLight = new DirectionalLight("#fff1e0", 3);
  sunLight.position.copy(SUN).multiplyScalar(10);
  scene.add(sunLight, new AmbientLight("#8fb3a8", 0.5));

  /* ----- Fondo: cielo de galaxia, estrellas y galaxia espiral ----- */
  const sky = buildSky(renderer, mobile ? 512 : 1024);
  scene.background = sky.texture;
  const stars = buildStars(mobile ? 1400 : 2600, px);
  const galaxy = buildGalaxy(mobile ? 4500 : 9000, px);
  scene.add(stars, galaxy.root);

  /* ----- Cuerpos ----- */
  const segments = mobile ? 64 : 112;
  const rocky = (palette: [string, string, string, string, string], caps: number, seed: number, craters: number) =>
    new ShaderMaterial({
      vertexShader: PLANET_VERTEX,
      fragmentShader: ROCKY_FRAGMENT,
      uniforms: {
        uSun: { value: SUN },
        uDark: { value: rgb(palette[0]) },
        uMid: { value: rgb(palette[1]) },
        uMain: { value: rgb(palette[2]) },
        uLight: { value: rgb(palette[3]) },
        uIce: { value: rgb("#f4ece4") },
        uHaze: { value: rgb(palette[4]) },
        uCaps: { value: caps },
        uSeed: { value: seed },
        uReveal: { value: 1 },
        uCraters: { value: craters },
        uMap: { value: null as Texture | null },
        uUseMap: { value: 0 },
      },
    });

  function buildBody(
    center: Vec3,
    radius: number,
    material: ShaderMaterial,
    sites: readonly Terrain[],
    motion: { idle: number; drift: number; rest: number },
  ): Body {
    const pivot = new Group();
    pivot.position.set(...center);
    pivot.rotation.order = "YXZ";
    pivot.rotation.x = motion.rest;
    const spin = new Group();
    spin.add(new Mesh(new SphereGeometry(radius, segments, segments / 2), material));
    pivot.add(spin);
    scene.add(pivot);
    const markers = sites.map((site) => buildMarker(site, radius, labels));
    markers.forEach((m) => spin.add(m.root));
    return { center: new Vector3(...center), radius, pivot, spin, markers, yaw: motion.idle, ...motion };
  }

  const landMask = buildLandMask();
  const earthMaterial = new ShaderMaterial({
    vertexShader: PLANET_VERTEX,
    fragmentShader: EARTH_FRAGMENT,
    uniforms: { uMask: { value: landMask }, uSun: { value: SUN }, uTime: { value: 0 }, uReveal: { value: 1 } },
  });
  const earth = buildBody(EARTH_CENTER, EARTH_RADIUS, earthMaterial, options.candidates, {
    idle: 2.4,
    drift: 0.05,
    rest: 0.2,
  });
  const earthHalo = buildHalo(EARTH_RADIUS, 1.12, "#6fd6cf", 0.6);
  earth.pivot.add(earthHalo);

  const moonMaterial = rocky(["#3d403f", "#77797a", "#a9aaa6", "#d8d6cf", "#c8d2cf"], 0, 4.2, 1);
  // La Luna con su relieve real; hasta que llega la imagen se ve la versión dibujada.
  let moonRelief: Texture | null = null;
  new TextureLoader().load(moonReliefUrl, (texture) => {
    texture.colorSpace = SRGBColorSpace;
    texture.wrapS = RepeatWrapping;
    texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
    moonRelief = texture;
    moonMaterial.uniforms.uMap.value = texture;
    moonMaterial.uniforms.uUseMap.value = 1;
  });
  const moon = buildBody(
    MOON_CENTER,
    MOON_RADIUS,
    moonMaterial,
    options.regions.filter((r) => r.world === "Luna"),
    { idle: 1.1, drift: 0.03, rest: 0.08 },
  );

  const mars = buildBody(
    MARS_CENTER,
    MARS_RADIUS,
    rocky(["#4a2219", "#9c4526", "#d47c4e", "#efbd92", "#ff9d6b"], 1, 0, 0),
    options.regions.filter((r) => r.world === "Marte"),
    { idle: 0.6, drift: 0.045, rest: 0.1 },
  );
  mars.pivot.add(buildHalo(MARS_RADIUS, 1.09, "#ff9566", 0.5));

  /* ----- Ruta de la sonda: Tierra → Luna → Marte → Tierra ----- */
  const point = (center: Vec3, dx: number, dy: number, dz: number) =>
    new Vector3(center[0] + dx, center[1] + dy, center[2] + dz);
  // sizes: tamaño de la sonda al salir, al llegar y cuánto crece a mitad de tramo.
  const legs = [
    {
      curve: new QuadraticBezierCurve3(
        point(EARTH_CENTER, 1, 0.9, 1.2),
        point(EARTH_CENTER, 1.6, 3, -0.3),
        point(MOON_CENTER, -0.5, -0.2, 0.45),
      ),
      dots: 44,
      progress: moonLegT,
      sizes: [0.04, 0.016, 0.02],
    },
    {
      curve: new QuadraticBezierCurve3(
        point(MOON_CENTER, -0.45, 0.2, 0.5),
        new Vector3(8.5, -2.2, -14),
        new Vector3(1.35, -0.25, -1.1),
      ),
      dots: 220,
      progress: marsLegT,
      sizes: [0.016, 0.04, 0.08],
    },
    {
      curve: new QuadraticBezierCurve3(
        new Vector3(1.25, 0.35, -1.3),
        new Vector3(3.7, 3, -12),
        point(EARTH_CENTER, -1.2, 0.45, 1.5),
      ),
      dots: 220,
      progress: travelT,
      sizes: [0.04, 0.04, 0.095],
    },
  ];
  const totalDots = legs.reduce((sum, leg) => sum + leg.dots, 0);
  const pathPositions = new Float32Array(totalDots * 3);
  const pathT = new Float32Array(totalDots);
  const tmp = new Vector3();
  let dot = 0;
  legs.forEach((leg, index) => {
    for (let i = 0; i < leg.dots; i++, dot++) {
      const t = i / (leg.dots - 1);
      leg.curve.getPoint(t, tmp);
      pathPositions.set([tmp.x, tmp.y, tmp.z], dot * 3);
      // Parte entera: tramo; parte decimal: avance dentro del tramo.
      pathT[dot] = index + t * 0.999;
    }
  });
  const pathGeometry = new BufferGeometry();
  pathGeometry.setAttribute("position", new BufferAttribute(pathPositions, 3));
  pathGeometry.setAttribute("aT", new BufferAttribute(pathT, 1));
  const pathMaterial = new ShaderMaterial({
    vertexShader: PATH_VERTEX,
    fragmentShader: PATH_FRAGMENT,
    uniforms: {
      uPx: { value: px },
      uHead: { value: 0 },
      uOpacity: { value: 0 },
      uDone: { value: rgb("#ffb48a") },
      uAhead: { value: rgb("#bfd8cd") },
    },
    transparent: true,
    depthWrite: false,
  });
  const path = new Points(pathGeometry, pathMaterial);
  path.frustumCulled = false;
  scene.add(path);

  const probe = buildProbe();
  scene.add(probe.root);

  /* ----- Estado ----- */
  let calm = options.calm;
  let targetP = 0;
  let camP = 0;
  let time = 0;
  let dirty = true;
  let earthFace = EARTH_FACE;
  let moonId = moon.markers[0]?.id ?? "";
  let marsId = mars.markers[0]?.id ?? "";
  let wide = !narrow();
  let disposed = false;
  let first = true;

  const target = new Vector3();
  const offset = new Vector3();
  const nearEarth = new Vector3();
  const nearMoon = new Vector3();
  const nearMars = new Vector3();
  const here = new Vector3();
  const ahead = new Vector3();
  const world = new Vector3();
  const normal = new Vector3();
  const toCamera = new Vector3();
  const lookQuat = new Quaternion();
  const FORWARD = new Vector3(0, 0, 1);

  /**
   * Posición de la sonda: órbita de salida, tramo y órbita de llegada, enlazados sin saltos.
   * Devuelve el tramo (parte entera) y su avance (parte decimal).
   */
  function probePosition(at: number, p: number, out: Vector3): number {
    const ae = at * 0.2 + 2.2;
    nearEarth.set(Math.cos(ae) * 1.78, -Math.sin(ae) * 0.5, Math.sin(ae) * 1.7).add(earth.center);
    const al = at * 0.3 + 0.4;
    nearMoon.set(Math.cos(al) * 0.7, Math.sin(al) * 0.2, Math.sin(al) * 0.66).add(moon.center);
    const am = at * 0.22 + 0.9;
    nearMars.set(Math.cos(am) * 1.5, Math.sin(am) * 0.44, Math.sin(am) * 1.44).add(mars.center);
    const index = p < 1.05 ? 0 : p < 2.2 ? 1 : 2;
    const from = [nearEarth, nearMoon, nearMars][index];
    const to = [nearMoon, nearMars, nearEarth][index];
    const t = legs[index].progress(p);
    legs[index].curve.getPoint(t, out);
    out.lerp(from, 1 - smoothstep(0, 0.16, t));
    out.lerp(to, smoothstep(0.84, 1, t));
    return index + t * 0.999;
  }

  /** Gira el cuerpo; con foco 1 deja la latitud y longitud dadas mirando a la cámara. */
  function orient(body: Body, focus: number, lat: number, lon: number, ease: number, dt: number) {
    if (!calm) body.idle += dt * body.drift;
    const goal = body.idle + shortestAngle(body.idle, yawFacing(lon)) * focus;
    body.yaw += shortestAngle(body.yaw, goal) * ease;
    body.spin.rotation.y = body.yaw;
    const azimuth = Math.atan2(camera.position.x - body.center.x, camera.position.z - body.center.z);
    body.pivot.rotation.y = azimuth * focus;
    const tilt = ((lat * Math.PI) / 180) * 0.85 * focus + body.rest * (1 - focus);
    body.pivot.rotation.x += (tilt - body.pivot.rotation.x) * ease;
  }

  function resize() {
    const w = Math.max(1, host.clientWidth);
    const h = Math.max(1, host.clientHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    wide = !narrow();
    dirty = true;
  }

  function placeMarker(marker: Marker, center: Vector3, weight: number) {
    if (!marker.root.visible) {
      marker.label.style.visibility = "hidden";
      return;
    }
    const w = host.clientWidth;
    const h = host.clientHeight;
    marker.root.getWorldPosition(world);
    normal.copy(world).sub(center).normalize();
    toCamera.copy(camera.position).sub(world).normalize();
    const facing = smoothstep(0.02, 0.2, normal.dot(toCamera));
    world.project(camera);
    const x = (world.x * 0.5 + 0.5) * w;
    const y = (0.5 - world.y * 0.5) * h;
    // En pantallas estrechas el texto ocupa la parte baja: ahí las etiquetas se apagan.
    const clear = wide ? 1 : 1 - smoothstep(0.34, 0.42, y / h);
    const opacity = weight * facing * clear * (marker.active ? 1 : 0.62);
    const style = marker.label.style;
    style.opacity = opacity.toFixed(3);
    style.visibility = opacity < 0.02 ? "hidden" : "visible";
    style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    marker.label.classList.toggle("izquierda", x > w * 0.58);
    const pulse = calm ? 0.5 : (time * 0.55) % 1;
    marker.pulse.scale.setScalar(marker.active ? 1 + pulse * 1.5 : 1);
    marker.materials[0].opacity = weight * (marker.active ? 1 : 0.5);
    marker.materials[1].opacity = weight * (marker.active ? 1 : 0.6);
    marker.materials[2].opacity = marker.active ? weight * (1 - pulse) * 0.8 : 0;
  }

  function update(dt: number) {
    const snap = calm || first;
    const goal = calm ? Math.round(targetP) : targetP;
    camP = snap ? goal : camP + (goal - camP) * (1 - Math.exp(-dt * 4.5));
    const ease = snap ? 1 : 1 - Math.exp(-dt * 3.2);

    /* Cámara */
    const shot = sampleShots(SHOTS, camP);
    target.set(...shot.target);
    const aspect = camera.aspect;
    const fit = wide ? 1 : 1 + shot.fit * (Math.min(2.2, Math.max(1, 0.9 / aspect)) - 1);
    offset.set(...shot.pos).sub(target).multiplyScalar(fit);
    camera.position.copy(target).add(offset);
    camera.lookAt(target);
    const w = host.clientWidth;
    const h = host.clientHeight;
    camera.setViewOffset(w, h, wide ? -shot.shift * w : 0, wide ? 0 : h * 0.21, w, h);

    /* Cada cuerpo encara su punto de interés durante su capítulo */
    const moonFocus = smoothstep(0.45, 0.9, camP) * (1 - smoothstep(1.15, 1.6, camP));
    const marsFocus = smoothstep(1.55, 1.95, camP) * (1 - smoothstep(2.3, 2.9, camP));
    const earthFocus = smoothstep(3.35, 3.9, camP) * (1 - smoothstep(4.35, 4.9, camP));
    const moonSite = options.regions.find((r) => r.id === moonId);
    const marsSite = options.regions.find((r) => r.id === marsId);
    orient(moon, moonFocus, moonSite?.latitude ?? 0, moonSite?.longitude ?? 0, ease, dt);
    orient(mars, marsFocus, marsSite?.latitude ?? 0, marsSite?.longitude ?? 0, ease, dt);
    orient(earth, earthFocus, earthFace.lat, earthFace.lon, ease, dt);

    // En el capítulo de Marte, la Tierra y la Luna se apagan: quedan detrás de él y no deben asomar.
    const reveal = 1 - smoothstep(1.6, 1.95, camP) * (1 - smoothstep(2.05, 2.5, camP));
    earth.pivot.visible = moon.pivot.visible = reveal > 0.001;
    earthMaterial.uniforms.uReveal.value = reveal;
    moonMaterial.uniforms.uReveal.value = reveal;
    (earthHalo.material as ShaderMaterial).uniforms.uStrength.value = 0.6 * reveal;

    /* Sonda y ruta */
    const head = probePosition(time, camP, here);
    probePosition(time + 0.06, camP + 0.003, ahead);
    probe.root.position.copy(here);
    if (ahead.sub(here).lengthSq() > 1e-10) {
      lookQuat.setFromUnitVectors(FORWARD, ahead.normalize());
      if (snap) probe.root.quaternion.copy(lookQuat);
      else probe.root.quaternion.slerp(lookQuat, 1 - Math.exp(-dt * 5));
    }
    const t = head - Math.floor(head);
    const [sizeFrom, sizeTo, sizeBump] = legs[Math.floor(head)].sizes;
    probe.root.scale.setScalar(sizeFrom + (sizeTo - sizeFrom) * t + sizeBump * Math.sin(Math.PI * t));
    probe.glow.scale.setScalar(calm ? 1 : 0.85 + 0.3 * Math.sin(time * 9));
    pathMaterial.uniforms.uHead.value = head;
    pathMaterial.uniforms.uOpacity.value = 1 - smoothstep(4.1, 4.8, camP);

    /* Tiempo de los shaders */
    earthMaterial.uniforms.uTime.value = time;
    (stars.material as ShaderMaterial).uniforms.uTime.value = time;
    (galaxy.disc.material as ShaderMaterial).uniforms.uTime.value = time;
    galaxy.disc.rotation.y = time * 0.006;

    return { moonFocus, marsFocus, earthFocus };
  }

  let last = performance.now();
  let raf = 0;
  function frame(now: number) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (calm && !dirty) return;
    if (!calm) time += dt;
    const { moonFocus, marsFocus, earthFocus } = update(dt);
    renderer.render(scene, camera);
    moon.markers.forEach((m) => placeMarker(m, moon.center, moonFocus));
    mars.markers.forEach((m) => placeMarker(m, mars.center, marsFocus));
    earth.markers.forEach((m) => placeMarker(m, earth.center, earthFocus));
    if (first) {
      first = false;
      canvas.classList.add("lista");
    }
    dirty = false;
  }

  function paintMarkers(body: Body, on: string, off: string) {
    for (const marker of body.markers) {
      marker.materials.forEach((m) => m.color.set(marker.active ? on : off));
      marker.root.scale.setScalar((marker.active ? 1.15 : 0.8) * body.radius);
      marker.label.classList.toggle("activa", marker.active);
    }
  }

  const observer = new ResizeObserver(resize);
  observer.observe(host);
  const onLost = (event: Event) => {
    event.preventDefault();
    options.onContextLost();
  };
  canvas.addEventListener("webglcontextlost", onLost);
  resize();
  raf = requestAnimationFrame(frame);

  return {
    setProgress(p) {
      if (p === targetP) return;
      targetP = p;
      dirty = true;
    },
    setSelection(nextMoonId, nextMarsId, ranking) {
      moonId = nextMoonId;
      marsId = nextMarsId;
      moon.markers.forEach((m) => (m.active = m.id === moonId));
      paintMarkers(moon, "#ffb48a", "#eef0e6");
      mars.markers.forEach((m) => (m.active = m.id === marsId));
      paintMarkers(mars, "#fff6e6", "#f3d7bd");
      for (const marker of earth.markers) {
        const row = ranking.find((r) => r.site.id === marker.id);
        marker.active = row?.rank === 1;
        // Solo se ven los lugares del ranking vigente: los demás son de otra región de referencia.
        marker.root.visible = Boolean(row);
        if (row) marker.label.textContent = `${String(row.rank).padStart(2, "0")} · ${row.site.name}`;
      }
      earthFace = faceOf(ranking.map((row) => row.site), EARTH_FACE);
      paintMarkers(earth, "#ffb48a", "#f1ead9");
      dirty = true;
    },
    setCalm(value) {
      calm = value;
      dirty = true;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(raf);
      observer.disconnect();
      canvas.removeEventListener("webglcontextlost", onLost);
      scene.traverse((object: Object3D) => {
        const mesh = object as Mesh;
        mesh.geometry?.dispose();
        const material = mesh.material as Material | Material[] | undefined;
        if (Array.isArray(material)) material.forEach((m) => m.dispose());
        else material?.dispose();
      });
      landMask.dispose();
      moonRelief?.dispose();
      sky.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
      [moon, mars, earth].forEach((body) => body.markers.forEach((m) => m.label.remove()));
    },
  };
}
