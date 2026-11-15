/**
 * Globo 3D navegable del mundo interactivo: se gira arrastrando, se acerca con la rueda o
 * pellizcando, y vuela hasta un lugar al elegirlo. Según la distancia muestra continentes,
 * países, provincias o zonas como marcadores HTML sobre el globo.
 *
 * Costas y fronteras: Natural Earth 1:50m (dominio público) vía el paquete `world-atlas`.
 * Los colores del terreno y las nubes son ilustrativos: no son imágenes satelitales.
 * Este módulo se carga con import() dinámico junto con Three.js.
 */
import {
  CanvasTexture,
  Color,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  PerspectiveCamera,
  RepeatWrapping,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
  WebGLRenderer,
} from "three";
import type { Material, Object3D } from "three";
import mapUrl from "world-atlas/countries-50m.json?url";
import { clamp, latLonToVec3, shortestDegrees, smoothstep } from "../../three/geo";
import { BACKGROUND, NOISE, buildHalo, buildSky, buildStars } from "../../three/space";
import { shapesOf } from "./topology";
import type { Ring, Shape, Topology } from "./topology";
import { HOME_DISTANCE, MAX_DISTANCE, MIN_DISTANCE, levelAt } from "./view";

export interface GlobeNode {
  path: string[];
  name: string;
  /** Texto corto junto al nombre: cuántas localidades contiene o su distancia. */
  detail: string;
  /** Descripción completa para lectores de pantalla. */
  label: string;
  latitude: number;
  longitude: number;
}

export interface GlobeOptions {
  /** Contenedor del canvas; recibe el arrastre, la rueda y el teclado. */
  host: HTMLElement;
  /** Contenedor de los marcadores HTML. */
  markers: HTMLElement;
  /** Sin giro automático ni vuelos animados. */
  calm: boolean;
  onPick: (path: string[]) => void;
  /** Nivel de desglose visible: 0 continentes … 3 zonas. */
  onLevel: (level: number) => void;
  onMapError: () => void;
  onContextLost: () => void;
}

export interface GlobeHandle {
  /** Nodos de cada nivel, del 0 (continentes) al 3 (zonas). */
  setNodes(levels: GlobeNode[][]): void;
  /** Ruta elegida: sus nodos se resaltan. */
  setFocus(path: readonly string[]): void;
  flyTo(latitude: number, longitude: number, distance: number): void;
  /** Multiplica la distancia: menor que 1 acerca. */
  zoomBy(factor: number): void;
  home(): void;
  /** Ancho, en píxeles, que tapa una tarjeta a la derecha: el globo se centra en lo que queda libre. */
  setRightInset(pixels: number): void;
  setCalm(calm: boolean): void;
  dispose(): void;
}

const FOV = 45;
const START = { latitude: 6, longitude: -72 };

const EARTH_VERTEX = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vObj;
  varying vec3 vNw;
  varying vec3 vPw;
  void main() {
    vUv = uv;
    vObj = position;
    vNw = normalize(mat3(modelMatrix) * normal);
    vec4 world = modelMatrix * vec4(position, 1.0);
    vPw = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

/** Mapa: rojo = tierra firme, verde = costas y fronteras. Iluminado de frente para poder explorarlo entero. */
const EARTH_FRAGMENT = /* glsl */ `
  uniform sampler2D uMap;
  uniform float uTime;
  uniform float uCloud;
  varying vec2 vUv;
  varying vec3 vObj;
  varying vec3 vNw;
  varying vec3 vPw;
  ${NOISE}
  void main() {
    vec3 N = normalize(vNw);
    vec3 V = normalize(cameraPosition - vPw);
    vec3 p = normalize(vObj);
    vec4 map = texture2D(uMap, vUv);
    float land = smoothstep(0.35, 0.65, map.r);
    // La misma textura, desenfocada, da la plataforma costera.
    float shelf = texture2D(uMap, vUv, 4.0).r;

    float absLat = abs(p.y);
    float patches = fbm(p * 3.0 + 2.0);
    float relief = fbm(p * 22.0);
    float arid = (1.0 - smoothstep(0.0, 0.26, abs(absLat - 0.42))) * smoothstep(0.3, 0.55, patches);
    float cold = smoothstep(0.72, 0.92, absLat);
    vec3 landColor = mix(vec3(0.110, 0.290, 0.204), vec3(0.282, 0.467, 0.290), fbm(p * 6.0));
    landColor = mix(landColor, vec3(0.741, 0.592, 0.380), arid * 0.9);
    landColor = mix(landColor, vec3(0.62, 0.66, 0.62), cold * 0.8);
    landColor *= 0.84 + 0.32 * relief;
    vec3 seaColor = mix(vec3(0.024, 0.133, 0.200), vec3(0.063, 0.325, 0.392), smoothstep(0.02, 0.5, shelf));
    vec3 c = mix(seaColor, landColor, land);

    float ice = max(smoothstep(0.955, 0.985, absLat), land * smoothstep(0.9, 0.96, absLat));
    c = mix(c, vec3(0.86, 0.90, 0.90), ice);

    // Costas y fronteras
    c = mix(c, vec3(0.93, 0.95, 0.88), map.g * mix(0.34, 0.5, land));

    // Retícula cada 15 grados
    vec2 grid = vec2(vUv.x * 24.0, vUv.y * 12.0);
    vec2 width = max(fwidth(grid), vec2(0.0001));
    vec2 lines = abs(fract(grid - 0.5) - 0.5) / width;
    c += vec3(0.55, 0.85, 0.80) * (1.0 - min(min(lines.x, lines.y), 1.0)) * 0.085;

    float a = uTime * 0.01;
    vec3 q = p;
    q.xz = mat2(cos(a), -sin(a), sin(a), cos(a)) * q.xz;
    float cloud = smoothstep(0.52, 0.74, fbm(q * 3.2)) * (0.5 + 0.5 * fbm(q * 9.0));
    c = mix(c, vec3(0.95, 0.97, 0.96), cloud * uCloud);

    float facing = max(dot(N, V), 0.0);
    vec3 col = c * (0.58 + 0.44 * facing);
    col += vec3(0.45, 0.85, 0.82) * pow(1.0 - facing, 2.6) * 0.5;
    gl_FragColor = vec4(col, 1.0);
  }
`;

/** Pinta los países en proyección equirrectangular: rojo para el relleno, verde para el contorno. */
function paintMap(shapes: readonly Shape[], width: number): HTMLCanvasElement {
  const height = width / 2;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  const x = (lon: number) => ((lon + 180) / 360) * width;
  const y = (lat: number) => ((90 - lat) / 180) * height;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = "#f00";
  for (const shape of shapes) {
    ctx.beginPath();
    for (const ring of shape.rings) {
      ring.forEach(([lon, lat], i) => (i ? ctx.lineTo(x(lon), y(lat)) : ctx.moveTo(x(lon), y(lat))));
      ctx.closePath();
    }
    ctx.fill("evenodd");
  }
  // Los datos terminan cerca de 85,6° S: el resto, hasta el polo, es Antártida.
  ctx.fillRect(0, y(-85.5), width, height - y(-85.5));

  // Los países cortados en el antimeridiano o en el borde sur tienen lados que no son costa ni frontera.
  const artificial = (a: Ring[number], b: Ring[number]) =>
    (Math.abs(a[0]) > 179.9 && Math.abs(b[0]) > 179.9) || (a[1] < -85.4 && b[1] < -85.4);
  ctx.globalCompositeOperation = "lighter";
  ctx.strokeStyle = "#0f0";
  ctx.lineWidth = Math.max(1, (width / 4096) * 1.7);
  ctx.lineJoin = "round";
  ctx.beginPath();
  for (const shape of shapes) {
    for (const ring of shape.rings) {
      for (let i = 1; i < ring.length; i++) {
        if (artificial(ring[i - 1], ring[i])) continue;
        ctx.moveTo(x(ring[i - 1][0]), y(ring[i - 1][1]));
        ctx.lineTo(x(ring[i][0]), y(ring[i][1]));
      }
    }
  }
  ctx.stroke();
  return canvas;
}

interface Mark {
  node: GlobeNode;
  element: HTMLButtonElement;
  position: Vector3;
}

export function createGlobe(options: GlobeOptions): GlobeHandle {
  const { host, markers } = options;
  const isWide = () => host.clientWidth >= 900;
  const mobile = !isWide() || /Mobi|Android|iPhone/i.test(navigator.userAgent);

  // Lanza un error si el navegador no puede crear el contexto WebGL: quien llama muestra solo la lista.
  const renderer = new WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  const px = Math.min(window.devicePixelRatio || 1, mobile ? 1.5 : 2);
  renderer.setPixelRatio(px);
  renderer.setClearColor(new Color(BACKGROUND), 1);
  const canvas = renderer.domElement;
  canvas.setAttribute("aria-hidden", "true");
  host.append(canvas);

  const scene = new Scene();
  const camera = new PerspectiveCamera(FOV, 1, 0.02, 900);
  const sky = buildSky(renderer, mobile ? 512 : 1024);
  scene.background = sky.texture;
  const stars = buildStars(mobile ? 1200 : 2200, px);
  scene.add(stars);

  /* ----- Tierra ----- */
  const blank = document.createElement("canvas");
  blank.width = 2;
  blank.height = 1;
  const map = new CanvasTexture(blank);
  map.wrapS = RepeatWrapping;
  map.minFilter = LinearFilter;
  const earthMaterial = new ShaderMaterial({
    vertexShader: EARTH_VERTEX,
    fragmentShader: EARTH_FRAGMENT,
    uniforms: { uMap: { value: map }, uTime: { value: 0 }, uCloud: { value: 0 } },
  });
  scene.add(new Mesh(new SphereGeometry(1, 160, 80), earthMaterial));
  // El halo se ilumina desde la cámara: el borde brilla parejo desde cualquier ángulo.
  const viewDirection = new Vector3(0, 0, 1);
  const halo = buildHalo(1, 1.1, "#6fd6cf", 0.5);
  (halo.material as ShaderMaterial).uniforms.uSun.value = viewDirection;
  scene.add(halo);

  let disposed = false;
  fetch(mapUrl)
    .then((response) => {
      if (!response.ok) throw new Error(String(response.status));
      return response.json() as Promise<Topology>;
    })
    .then((topology) => {
      if (disposed) return;
      const size = Math.min(mobile ? 2048 : 4096, renderer.capabilities.maxTextureSize);
      map.image = paintMap(shapesOf(topology, "countries"), size);
      map.minFilter = LinearMipmapLinearFilter;
      map.generateMipmaps = true;
      map.anisotropy = renderer.capabilities.getMaxAnisotropy();
      map.needsUpdate = true;
      dirty = true;
    })
    .catch(() => {
      if (!disposed) options.onMapError();
    });

  /* ----- Estado de la cámara: valores actuales y destino ----- */
  let calm = options.calm;
  let homeDistance = HOME_DISTANCE;
  let latitude = START.latitude;
  let longitude = START.longitude;
  let distance = homeDistance;
  let goalLatitude = latitude;
  let goalLongitude = longitude;
  let goalDistance = distance;
  let flying = false;
  let rightInset = 0;
  let rightInsetNow = 0;
  let touched = false;
  let time = 0;
  let dirty = true;
  let wide = isWide();

  /* ----- Marcadores ----- */
  let levels: GlobeNode[][] = [[], [], [], []];
  let level = -1;
  let focus: readonly string[] = [];
  let marks: Mark[] = [];
  const projected = new Vector3();

  const isOnFocus = (path: readonly string[]) => path.length <= focus.length && path.every((name, i) => focus[i] === name);

  function paintFocus() {
    for (const mark of marks) mark.element.classList.toggle("activa", isOnFocus(mark.node.path));
  }

  function rebuildMarks() {
    marks = (levels[level] ?? []).map((node) => {
      const element = document.createElement("button");
      element.type = "button";
      element.className = "mk";
      element.setAttribute("aria-label", node.label);
      const dot = document.createElement("span");
      dot.className = "mk-punto";
      const cloud = document.createElement("span");
      cloud.className = "mk-nube";
      const name = document.createElement("b");
      name.textContent = node.name;
      const detail = document.createElement("i");
      detail.textContent = node.detail;
      cloud.append(name, detail);
      element.append(dot, cloud);
      element.addEventListener("click", () => options.onPick(node.path));
      return { node, element, position: new Vector3(...latLonToVec3(node.latitude, node.longitude)) };
    });
    markers.replaceChildren(...marks.map((mark) => mark.element));
    paintFocus();
    dirty = true;
  }

  function placeMarks() {
    const w = host.clientWidth;
    const h = host.clientHeight;
    // Un punto se ve si queda del lado de la cámara, más allá del horizonte del globo.
    const horizon = 1 / distance;
    const placed: { x: number; y: number }[] = [];
    for (const mark of marks) {
      const facing = mark.position.dot(viewDirection);
      const visible = smoothstep(horizon + 0.02, horizon + 0.12, facing);
      projected.copy(mark.position).multiplyScalar(1.004).project(camera);
      const x = (projected.x * 0.5 + 0.5) * w;
      const y = (0.5 - projected.y * 0.5) * h;
      const inside = x > -40 && x < w + 40 && y > -40 && y < h + 40;
      const style = mark.element.style;
      style.opacity = visible.toFixed(3);
      style.visibility = visible < 0.05 || !inside ? "hidden" : "visible";
      style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      mark.element.classList.toggle("izquierda", x > w * 0.74);
      // Si otra nube ya ocupa ese sitio, esta se cuelga por debajo de su punto.
      const shown = visible >= 0.05 && inside;
      const crowded = shown && placed.some((other) => Math.abs(other.x - x) < 230 && Math.abs(other.y - y) < 30);
      mark.element.classList.toggle("abajo", crowded);
      if (shown && !crowded) placed.push({ x, y });
    }
  }

  /* ----- Navegación ----- */
  /** Grados que gira el globo por cada píxel arrastrado: el punto agarrado sigue al cursor. */
  const dragScale = () => ((distance - 1) * 2 * Math.tan((FOV * Math.PI) / 360) * 180) / Math.PI / host.clientHeight;
  const clampDistance = (d: number) => clamp(d, MIN_DISTANCE, Math.max(MAX_DISTANCE, homeDistance));

  function interact() {
    touched = true;
    flying = false;
    dirty = true;
  }

  const pointers = new Map<number, { x: number; y: number }>();
  let pinch = 0;

  function onPointerDown(event: PointerEvent) {
    if (event.target !== canvas) return;
    host.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    pinch = 0;
    host.classList.add("arrastrando");
    interact();
  }

  function onPointerMove(event: PointerEvent) {
    const previous = pointers.get(event.pointerId);
    if (!previous) return;
    const next = { x: event.clientX, y: event.clientY };
    pointers.set(event.pointerId, next);
    if (pointers.size === 1) {
      const scale = dragScale();
      goalLongitude -= (next.x - previous.x) * scale;
      goalLatitude = clamp(goalLatitude + (next.y - previous.y) * scale, -85, 85);
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const span = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch > 0 && span > 0) goalDistance = clampDistance(goalDistance * (pinch / span));
      pinch = span;
    }
    interact();
  }

  function onPointerUp(event: PointerEvent) {
    pointers.delete(event.pointerId);
    pinch = 0;
    if (!pointers.size) host.classList.remove("arrastrando");
  }

  function onWheel(event: WheelEvent) {
    event.preventDefault();
    const delta = event.deltaMode === 1 ? event.deltaY * 32 : event.deltaY;
    goalDistance = clampDistance(goalDistance * Math.exp(delta * 0.0014));
    interact();
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.target !== host) return;
    const step = Math.max(2, (distance - 1) * 9);
    if (event.key === "ArrowLeft") goalLongitude -= step;
    else if (event.key === "ArrowRight") goalLongitude += step;
    else if (event.key === "ArrowUp") goalLatitude = clamp(goalLatitude + step, -85, 85);
    else if (event.key === "ArrowDown") goalLatitude = clamp(goalLatitude - step, -85, 85);
    else if (event.key === "+" || event.key === "=") goalDistance = clampDistance(goalDistance * 0.8);
    else if (event.key === "-" || event.key === "_") goalDistance = clampDistance(goalDistance * 1.25);
    else if (event.key === "Home") goalDistance = homeDistance;
    else return;
    event.preventDefault();
    interact();
  }

  function resize() {
    const w = Math.max(1, host.clientWidth);
    const h = Math.max(1, host.clientHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    wide = isWide();
    // En pantallas verticales el globo completo necesita más distancia para caber a lo ancho.
    const halfWidth = Math.atan(Math.tan((FOV * Math.PI) / 360) * camera.aspect);
    const fitted = Math.max(HOME_DISTANCE, 1 / Math.sin(Math.min(halfWidth * 0.86, Math.PI / 2)));
    if (!touched) goalDistance = distance = fitted;
    homeDistance = fitted;
    dirty = true;
  }

  function update(dt: number) {
    // Giro lento de presentación hasta que alguien toma el control.
    if (!touched && !calm) goalLongitude += dt * 3.5;
    const ease = calm ? 1 : 1 - Math.exp(-dt * (flying ? 3 : 10));
    latitude += (goalLatitude - latitude) * ease;
    longitude += shortestDegrees(longitude, goalLongitude) * ease;
    distance += (goalDistance - distance) * ease;
    const settled =
      Math.abs(goalLatitude - latitude) < 0.01 &&
      Math.abs(shortestDegrees(longitude, goalLongitude)) < 0.01 &&
      Math.abs(goalDistance - distance) < 0.001;
    if (settled) flying = false;

    camera.position.set(...latLonToVec3(latitude, longitude, distance));
    camera.lookAt(0, 0, 0);
    viewDirection.copy(camera.position).normalize();
    const w = host.clientWidth;
    const h = host.clientHeight;
    // El panel tapa la izquierda en pantallas anchas y la parte baja en las estrechas: el globo se centra en el resto.
    rightInsetNow += (rightInset - rightInsetNow) * (calm ? 1 : 1 - Math.exp(-dt * 6));
    const leftInset = Math.min(412, w * 0.4);
    camera.setViewOffset(w, h, wide ? -Math.max(0, leftInset - rightInsetNow) / 2 : 0, wide ? 0 : h * 0.2, w, h);

    earthMaterial.uniforms.uTime.value = time;
    earthMaterial.uniforms.uCloud.value = smoothstep(2.3, 3.6, distance) * 0.5;
    (stars.material as ShaderMaterial).uniforms.uTime.value = time;

    const nextLevel = levelAt(distance);
    if (nextLevel !== level) {
      level = nextLevel;
      rebuildMarks();
      options.onLevel(level);
    }
    return settled;
  }

  let last = performance.now();
  let raf = 0;
  function frame(now: number) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (calm && !dirty) return;
    if (!calm) time += dt;
    const settled = update(dt);
    renderer.render(scene, camera);
    placeMarks();
    canvas.classList.add("lista");
    dirty = !settled;
  }

  const observer = new ResizeObserver(resize);
  observer.observe(host);
  const onLost = (event: Event) => {
    event.preventDefault();
    options.onContextLost();
  };
  canvas.addEventListener("webglcontextlost", onLost);
  host.addEventListener("pointerdown", onPointerDown);
  host.addEventListener("pointermove", onPointerMove);
  host.addEventListener("pointerup", onPointerUp);
  host.addEventListener("pointercancel", onPointerUp);
  host.addEventListener("wheel", onWheel, { passive: false });
  markers.addEventListener("wheel", onWheel, { passive: false });
  host.addEventListener("keydown", onKeyDown);
  resize();
  raf = requestAnimationFrame(frame);

  return {
    setNodes(next) {
      levels = next;
      if (level >= 0) rebuildMarks();
    },
    setFocus(path) {
      focus = path;
      paintFocus();
    },
    flyTo(lat, lon, d) {
      goalLatitude = clamp(lat, -85, 85);
      goalLongitude = lon;
      goalDistance = clampDistance(d);
      touched = true;
      flying = true;
      dirty = true;
    },
    zoomBy(factor) {
      goalDistance = clampDistance(goalDistance * factor);
      interact();
    },
    home() {
      goalDistance = homeDistance;
      touched = true;
      flying = true;
      dirty = true;
    },
    setRightInset(pixels) {
      rightInset = pixels;
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
      host.removeEventListener("pointerdown", onPointerDown);
      host.removeEventListener("pointermove", onPointerMove);
      host.removeEventListener("pointerup", onPointerUp);
      host.removeEventListener("pointercancel", onPointerUp);
      host.removeEventListener("wheel", onWheel);
      markers.removeEventListener("wheel", onWheel);
      host.removeEventListener("keydown", onKeyDown);
      host.classList.remove("arrastrando");
      scene.traverse((object: Object3D) => {
        const mesh = object as Mesh;
        mesh.geometry?.dispose();
        const material = mesh.material as Material | Material[] | undefined;
        if (Array.isArray(material)) material.forEach((m) => m.dispose());
        else material?.dispose();
      });
      map.dispose();
      sky.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
      markers.replaceChildren();
    },
  };
}
