/**
 * El holograma del hangar: un robot proyectado sobre una base de luz, que se gira, se desarma en
 * sus componentes y deja resaltar uno. La escena solo dibuja; las etiquetas las pone la página con
 * las posiciones que se le entregan (`onAnchors`).
 *
 * - Arrastrar gira la vista, la rueda o el pellizco acercan y un clic sin arrastrar elige pieza.
 * - `rotateBy` y `zoomBy` hacen lo mismo desde fuera (los gestos con la mano).
 * - Con movimiento reducido (`calm`) no hay parpadeo, ni giro solo, ni barrido de entrada, y solo
 *   se vuelve a dibujar cuando algo cambia.
 *
 * Sistema del robot: +x hacia delante, +y arriba, +z a su derecha. La cámara empieza delante y a
 * la derecha del robot, un poco por encima.
 */
import {
  ACESFilmicToneMapping,
  AmbientLight,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  HemisphereLight,
  LineSegments,
  PMREMGenerator,
  PerspectiveCamera,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";
import type { Texture } from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { HOLO_ACCENT, HOLO_TEAL, createShared, depthMaterial, leaderMaterial } from "./holoMaterials";
import { approach, ease, fitDistance } from "./holoMath";
import { ownPaints, prepareRobot } from "./holoPieces";
import type { HoloPiece, HoloRobot } from "./holoPieces";
import { createStage } from "./holoStage";
import type { HoloRobotId } from "./parts";

export type HoloStyle = "holograma" | "real";

/** Posición de la etiqueta de un componente, en píxeles dentro del contenedor. */
export interface HoloAnchor {
  x: number;
  y: number;
  visible: boolean;
}

/** Lo que trae un robot ya cargado: los componentes que tienen piezas propias. */
export interface HoloLoad {
  parts: string[];
  official: boolean;
}

export interface HoloScene {
  /** Cambia el robot y lo «proyecta» de abajo arriba. Falla si el modelo no se puede cargar. */
  load(robot: HoloRobotId): Promise<HoloLoad>;
  /** Deja la base vacía (robots sin forma 3D). */
  clear(): void;
  /** De 0 (armado) a 1 (desarmado del todo); se llega poco a poco. */
  setExplode(amount: number): void;
  /** Resalta un componente y atenúa los demás; null los deja todos iguales. */
  setSelected(part: string | null): void;
  /** Resalte suave, para cuando se pasa por la lista. */
  setHovered(part: string | null): void;
  setStyle(style: HoloStyle): void;
  setAutoRotate(on: boolean): void;
  /**
   * Gira la vista, en radianes. `yaw` positivo es como arrastrar hacia la derecha (el robot sigue
   * a la mano); `pitch` positivo sube la cámara.
   */
  rotateBy(yaw: number, pitch: number): void;
  /** Multiplica la distancia: menos de 1 acerca, más de 1 aleja. */
  zoomBy(factor: number): void;
  resetView(): void;
  /** Clic en una pieza (su componente) o en el vacío (null). */
  onPick: ((part: string | null) => void) | null;
  /** Posición de la etiqueta de cada componente, cada vez que cambian. */
  onAnchors: ((anchors: Record<string, HoloAnchor>) => void) | null;
  dispose(): void;
}

const BACKGROUND = "#070f0d";
const FOV = 34;
const START_YAW = 0.62;
const START_PITCH = 0.3;
const MIN_PITCH = -0.12;
const MAX_PITCH = 1.38;
const MIN_ZOOM = 0.42;
const MAX_ZOOM = 2.4;
/** Giro solo, rad/s, y cuánto espera después de que alguien toque la vista, s. */
const AUTO_RATE = 0.2;
const AUTO_WAIT_S = 2.5;
/** Lo que tarda el barrido de entrada, s. */
const SCAN_S = 1.25;
/** Niveles de luz: normal, resaltado, bajo el cursor de la lista y atenuado. */
const LEVEL = { normal: 1, selected: 1.75, hovered: 1.35, dimmed: 0.3 };
/** Un clic es un toque corto y casi sin moverse. */
const CLICK_PX = 6;
const CLICK_MS = 450;

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

export function createHoloScene(container: HTMLElement, options: { calm: boolean }): HoloScene {
  const { calm } = options;
  const renderer = new WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(new Color(BACKGROUND), 1);
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  const canvas = renderer.domElement;
  canvas.style.display = "block";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  // El arrastre gira la vista: el navegador no debe tomarlo por un desplazamiento de la página.
  canvas.style.touchAction = "none";
  container.appendChild(canvas);

  const scene = new Scene();
  const camera = new PerspectiveCamera(FOV, 1, 0.05, 200);
  const stage = createStage(calm);
  scene.add(stage.group);

  // Luces del estilo «real»: un estudio limpio, con un contraluz del color del holograma.
  const lights = [new HemisphereLight("#eef6f2", "#0b1412", 0.55), new AmbientLight("#ffffff", 0.12)] as const;
  const key = new DirectionalLight("#ffffff", 2.4);
  key.position.set(4, 6, 5);
  const rim = new DirectionalLight(HOLO_TEAL, 1.5);
  rim.position.set(-5, 3, -4);
  const studio = [...lights, key, rim];
  for (const light of studio) {
    light.visible = false;
    scene.add(light);
  }
  let environment: Texture | null = null;

  const shared = createShared();
  shared.uFlicker.value = calm ? 0 : 1;
  const depth = depthMaterial(shared);
  const teal = new Color(HOLO_TEAL);
  const accent = new Color(HOLO_ACCENT);

  // Líneas del sitio de cada pieza a donde está, al desarmar.
  const leaderOpacity = { value: 0 };
  const leaderMat = leaderMaterial({ value: teal.clone() }, leaderOpacity);
  let leaderGeometry = new BufferGeometry();
  const leaders = new LineSegments(leaderGeometry, leaderMat);
  leaders.frustumCulled = false;
  leaders.renderOrder = 6;
  leaders.visible = false;
  scene.add(leaders);

  // ---------- Estado ----------
  const robots = new Map<HoloRobotId, HoloRobot>();
  const loading = new Map<HoloRobotId, Promise<HoloRobot>>();
  let current: HoloRobot | null = null;
  let loadToken = 0;
  let style: HoloStyle = "holograma";
  let selected: string | null = null;
  let hovered: string | null = null;
  let explodeTarget = 0;
  let explode = 0;
  let autoRotate = !calm;
  let lastTouch = -Infinity;
  /** Vista: a dónde quiere ir y dónde está. */
  const want = { yaw: START_YAW, pitch: START_PITCH, zoom: 1 };
  const view = { yaw: START_YAW, pitch: START_PITCH, zoom: 1 };
  /** Radio y altura del robot que está en la base. */
  let radius = 2;
  let height = 2;
  /** Barrido de entrada: segundos transcurridos, o -1 si no hay ninguno. */
  let scan = -1;
  let scanTop = 3;
  let width = 1;
  let heightPx = 1;
  let disposed = false;
  let frame = 0;
  let clock = 0;
  let last = 0;
  let anchorsStale = true;
  let anchorListener: ((anchors: Record<string, HoloAnchor>) => void) | null = null;
  /** Dedos o botones que están arrastrando ahora mismo. */
  let dragging = 0;

  const target = new Vector3();
  const point = new Vector3();
  const raycaster = new Raycaster();
  const pointerNdc = new Vector2();

  /** Alguien tocó la vista: el giro solo espera un rato antes de seguir. */
  const touch = () => {
    lastTouch = clock;
  };

  function applyStyle() {
    const real = style === "real";
    for (const light of studio) light.visible = real;
    if (real && !environment) {
      const pmrem = new PMREMGenerator(renderer);
      environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      pmrem.dispose();
    }
    scene.environment = real ? environment : null;
    if (!current) return;
    if (real) ownPaints(current);
    for (const piece of current.pieces) {
      for (const mesh of piece.originals) mesh.visible = real;
    }
  }

  /** Qué nivel de luz y cuánto color de acento le toca a cada pieza según lo elegido. */
  function looksFor(piece: HoloPiece, active: string | null, soft: string | null) {
    if (active) return piece.part === active ? { level: LEVEL.selected, warmth: 1 } : { level: LEVEL.dimmed, warmth: 0 };
    if (soft && piece.part === soft) return { level: LEVEL.hovered, warmth: 0.45 };
    return { level: LEVEL.normal, warmth: 0 };
  }

  /** El componente elegido solo cuenta si este robot tiene piezas suyas. */
  const present = (part: string | null) => (part && current?.parts.includes(part) ? part : null);

  function stepLooks(dt: number): boolean {
    if (!current) return false;
    const active = present(selected);
    const soft = present(hovered);
    const real = style === "real";
    let moving = false;
    for (const piece of current.pieces) {
      const goal = looksFor(piece, active, soft);
      const level = approach(piece.level, goal.level, 9, dt);
      const warmth = approach(piece.warmth, goal.warmth, 9, dt);
      if (Math.abs(level - goal.level) > 0.003 || Math.abs(warmth - goal.warmth) > 0.003) moving = true;
      piece.level = Math.abs(level - goal.level) > 0.003 ? level : goal.level;
      piece.warmth = Math.abs(warmth - goal.warmth) > 0.003 ? warmth : goal.warmth;
      piece.look.uLevel.value = piece.level;
      piece.look.uTint.value.copy(teal).lerp(accent, piece.warmth);
      // Las atenuadas pierden el relleno y quedan en sus aristas: la elegida se ve a través de ellas.
      const dimmed = active !== null && piece.part !== active;
      const solid = approach(piece.solid, dimmed ? 0 : 1, 9, dt);
      piece.solid = Math.abs(solid - (dimmed ? 0 : 1)) > 0.003 ? solid : dimmed ? 0 : 1;
      if (piece.solid !== (dimmed ? 0 : 1)) moving = true;
      piece.look.uSolid.value = piece.solid;
      if (real) {
        // Las atenuadas se oscurecen; la elegida se queda como es, con sus aristas en naranja.
        const shade = clamp((piece.level - LEVEL.dimmed) / (LEVEL.normal - LEVEL.dimmed), 0, 1) * 0.74 + 0.26;
        for (const paint of piece.paints ?? []) {
          paint.material.color.copy(paint.color).multiplyScalar(shade);
          paint.material.envMapIntensity = paint.env * shade;
          if (paint.emissive) paint.material.emissive.copy(paint.emissive).lerp(accent, piece.warmth * 0.1);
        }
        piece.depth.visible = false;
        piece.fill.visible = false;
        piece.ghost.visible = false;
        piece.edges.visible = piece.warmth > 0.02;
      } else {
        // Mientras le queda relleno sigue tapando lo de detrás; sin él, deja ver a través.
        piece.depth.visible = piece.solid > 0.04;
        piece.fill.visible = piece.solid > 0.01;
        piece.ghost.visible = piece.solid > 0.01;
        piece.edges.visible = true;
      }
    }
    return moving;
  }

  function placePieces() {
    if (!current) return;
    const amount = ease(explode);
    for (const piece of current.pieces) piece.object.position.copy(piece.home).addScaledVector(piece.offset, amount);
    const positions = leaderGeometry.getAttribute("position") as BufferAttribute | undefined;
    if (positions) {
      current.pieces.forEach((piece, index) => {
        positions.setXYZ(index * 2, piece.center.x, piece.center.y, piece.center.z);
        positions.setXYZ(index * 2 + 1, piece.center.x + piece.offset.x * amount, piece.center.y + piece.offset.y * amount, piece.center.z + piece.offset.z * amount);
      });
      positions.needsUpdate = true;
    }
    leaderOpacity.value = Math.min(1, amount * 1.6) * (style === "real" ? 0.55 : 1);
    leaders.visible = amount > 0.01;
  }

  function placeCamera() {
    const amount = ease(explode);
    const fit = fitDistance(radius, FOV, width / heightPx);
    const distance = fit * view.zoom * (1 + 0.46 * amount);
    target.set(0, height * (0.4 + 0.2 * amount), 0);
    const flat = Math.cos(view.pitch) * distance;
    camera.position.set(target.x + Math.cos(view.yaw) * flat, target.y + Math.sin(view.pitch) * distance, target.z + Math.sin(view.yaw) * flat);
    camera.near = Math.max(0.05, distance * 0.02);
    camera.far = distance * 12 + radius * 14;
    camera.lookAt(target);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
  }

  function emitAnchors() {
    anchorsStale = false;
    const listener = anchorListener;
    if (!listener) return;
    const anchors: Record<string, HoloAnchor> = {};
    if (current) {
      const amount = ease(explode);
      for (const [part, piece] of current.labelled) {
        point.copy(piece.center).addScaledVector(piece.offset, amount).project(camera);
        const x = (point.x * 0.5 + 0.5) * width;
        const y = (-point.y * 0.5 + 0.5) * heightPx;
        anchors[part] = { x, y, visible: point.z > -1 && point.z < 1 && x >= 0 && x <= width && y >= 0 && y <= heightPx };
      }
    }
    listener(anchors);
  }

  function render(now: number) {
    frame = 0;
    if (disposed) return;
    const dt = Math.min(0.1, last ? (now - last) / 1000 : 0.016);
    last = now;
    clock += dt;
    // Con movimiento reducido el tiempo de los adornos no corre: nada parpadea ni sube.
    if (!calm) {
      shared.uTime.value = clock;
      stage.step(clock);
    }

    let moving = false;
    if (autoRotate && current && clock - lastTouch > AUTO_WAIT_S && dragging === 0) {
      want.yaw += AUTO_RATE * dt;
      moving = true;
    }
    const before = view.yaw + view.pitch * 3 + view.zoom * 7 + explode * 11;
    view.yaw = approach(view.yaw, want.yaw, 10, dt);
    view.pitch = approach(view.pitch, want.pitch, 10, dt);
    view.zoom = approach(view.zoom, want.zoom, 8, dt);
    explode = approach(explode, explodeTarget, 5.5, dt);
    if (Math.abs(explode - explodeTarget) < 0.0008) explode = explodeTarget;
    const after = view.yaw + view.pitch * 3 + view.zoom * 7 + explode * 11;
    if (Math.abs(after - before) > 1e-5) {
      moving = true;
      anchorsStale = true;
    }

    if (scan >= 0) {
      scan += dt;
      const progress = scan / SCAN_S;
      shared.uReveal.value = progress >= 1 ? 1e6 : ease(progress) * scanTop;
      if (progress >= 1) scan = -1;
      moving = true;
    }
    if (stepLooks(dt)) moving = true;
    placePieces();
    placeCamera();
    renderer.render(scene, camera);
    if (anchorsStale) emitAnchors();
    // Con movimiento reducido solo se sigue dibujando mientras algo se mueve.
    if (!calm || moving) schedule();
  }

  function schedule() {
    if (frame || disposed || document.hidden) return;
    frame = requestAnimationFrame(render);
  }

  /** Pide un cuadro y vuelve a entregar las etiquetas. */
  function invalidate() {
    anchorsStale = true;
    schedule();
  }

  function mount(robot: HoloRobot) {
    if (current && current !== robot) scene.remove(current.root);
    current = robot;
    scene.add(robot.root);
    const size = robot.box.getSize(point);
    height = robot.box.max.y;
    // El radio que encierra al robot visto desde cualquier lado, con algo de aire.
    radius = Math.max(0.9, Math.hypot(size.x, size.z) / 2, height * 0.62) * 1.08;
    stage.fit(Math.max(size.x, size.z) * 0.62, height);
    // Las piezas llegan ya en su sitio: lo que se anima es la proyección, no el despiece.
    explode = explodeTarget;
    for (const piece of robot.pieces) {
      piece.level = LEVEL.normal;
      piece.warmth = 0;
      piece.solid = 1;
    }
    leaderGeometry.dispose();
    leaderGeometry = new BufferGeometry();
    leaderGeometry.setAttribute("position", new BufferAttribute(new Float32Array(robot.pieces.length * 6), 3));
    const ends = new Float32Array(robot.pieces.length * 2);
    for (let i = 0; i < robot.pieces.length; i++) ends[i * 2 + 1] = 1;
    leaderGeometry.setAttribute("aEnd", new BufferAttribute(ends, 1));
    leaders.geometry = leaderGeometry;
    applyStyle();
    if (calm) {
      shared.uReveal.value = 1e6;
      scan = -1;
    } else {
      // Hasta dónde llega lo más alto, con el despiece que haya puesto.
      const amount = ease(explodeTarget);
      const reach = robot.pieces.reduce((top, piece) => Math.max(top, piece.center.y + piece.offset.y * amount + size.y * 0.3), height);
      scanTop = reach + 0.3;
      shared.uReveal.value = 0;
      scan = 0;
    }
    invalidate();
  }

  // ---------- Puntero ----------
  const pointers = new Map<number, { x: number; y: number }>();
  let down = { x: 0, y: 0, at: 0, moved: 0 };
  let pinch = 0;

  const local = (event: PointerEvent | WheelEvent) => {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  function pick(x: number, y: number) {
    const listener = api.onPick;
    if (!listener) return;
    if (!current) {
      listener(null);
      return;
    }
    pointerNdc.set((x / width) * 2 - 1, -(y / heightPx) * 2 + 1);
    raycaster.setFromCamera(pointerNdc, camera);
    const fills = current.pieces.map((piece) => piece.fill);
    const hit = raycaster.intersectObjects(fills, false)[0];
    const piece = hit ? current.pieces[fills.indexOf(hit.object as (typeof fills)[number])] : undefined;
    listener(piece ? piece.part : null);
  }

  const onPointerDown = (event: PointerEvent) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    canvas.setPointerCapture(event.pointerId);
    const at = local(event);
    pointers.set(event.pointerId, at);
    dragging = pointers.size;
    if (pointers.size === 1) down = { ...at, at: performance.now(), moved: 0 };
    else {
      const [a, b] = [...pointers.values()];
      pinch = Math.hypot(a.x - b.x, a.y - b.y);
      down.moved = CLICK_PX * 2;
    }
    touch();
    schedule();
  };

  const onPointerMove = (event: PointerEvent) => {
    const previous = pointers.get(event.pointerId);
    if (!previous) return;
    const at = local(event);
    pointers.set(event.pointerId, at);
    if (pointers.size === 1) {
      const dx = at.x - previous.x;
      const dy = at.y - previous.y;
      down.moved += Math.abs(dx) + Math.abs(dy);
      api.rotateBy(dx * 0.0075, dy * 0.0055);
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const spread = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch > 0 && spread > 0) api.zoomBy(pinch / spread);
      pinch = spread;
    }
  };

  const onPointerUp = (event: PointerEvent) => {
    if (!pointers.has(event.pointerId)) return;
    const at = local(event);
    const wasClick = pointers.size === 1 && down.moved < CLICK_PX && performance.now() - down.at < CLICK_MS;
    pointers.delete(event.pointerId);
    dragging = pointers.size;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    touch();
    if (wasClick && event.type === "pointerup") pick(at.x, at.y);
  };

  const onWheel = (event: WheelEvent) => {
    event.preventDefault();
    api.zoomBy(Math.exp(clamp(event.deltaY, -240, 240) * 0.0012));
  };

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);
  canvas.addEventListener("wheel", onWheel, { passive: false });

  // ---------- Tamaño y pausa ----------
  function resize() {
    const rect = container.getBoundingClientRect();
    width = Math.max(1, Math.round(rect.width));
    heightPx = Math.max(1, Math.round(rect.height));
    renderer.setSize(width, heightPx, false);
    camera.aspect = width / heightPx;
    stage.resize(heightPx);
    invalidate();
  }
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  resize();

  const onVisibility = () => {
    if (document.hidden) {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
    } else {
      // Al volver no se cuenta el rato que la pestaña estuvo oculta.
      last = 0;
      schedule();
    }
  };
  document.addEventListener("visibilitychange", onVisibility);

  const api: HoloScene = {
    async load(id) {
      const token = ++loadToken;
      let robot = robots.get(id);
      if (!robot) {
        let pending = loading.get(id);
        if (!pending) {
          pending = prepareRobot(id, shared, depth);
          loading.set(id, pending);
        }
        try {
          robot = await pending;
        } finally {
          loading.delete(id);
        }
        if (disposed) {
          robot.dispose();
          throw new Error("La escena ya se cerró");
        }
        robots.set(id, robot);
      }
      // Si mientras tanto se pidió otro robot, este se queda guardado y no se muestra.
      if (token === loadToken) mount(robot);
      return { parts: [...robot.parts], official: robot.official };
    },
    clear() {
      loadToken++;
      if (current) scene.remove(current.root);
      current = null;
      leaders.visible = false;
      scan = -1;
      shared.uReveal.value = 1e6;
      invalidate();
    },
    setExplode(amount) {
      explodeTarget = clamp(amount, 0, 1);
      schedule();
    },
    setSelected(part) {
      selected = part;
      invalidate();
    },
    setHovered(part) {
      hovered = part;
      invalidate();
    },
    setStyle(next) {
      if (style === next) return;
      style = next;
      applyStyle();
      invalidate();
    },
    setAutoRotate(on) {
      autoRotate = on;
      // Al encenderlo empieza ya, sin esperar a que pase el rato desde el último toque.
      if (on) lastTouch = -Infinity;
      schedule();
    },
    rotateBy(yaw, pitch) {
      want.yaw += yaw;
      want.pitch = clamp(want.pitch + pitch, MIN_PITCH, MAX_PITCH);
      touch();
      schedule();
    },
    zoomBy(factor) {
      if (!(factor > 0)) return;
      want.zoom = clamp(want.zoom * factor, MIN_ZOOM, MAX_ZOOM);
      touch();
      schedule();
    },
    resetView() {
      // Vuelve por el camino corto: sin deshacer todas las vueltas que se hayan dado.
      const turns = Math.round((view.yaw - START_YAW) / (Math.PI * 2));
      want.yaw = START_YAW + turns * Math.PI * 2;
      want.pitch = START_PITCH;
      want.zoom = 1;
      touch();
      schedule();
    },
    onPick: null,
    get onAnchors() {
      return anchorListener;
    },
    set onAnchors(listener) {
      anchorListener = listener;
      // Quien empieza a escuchar recibe las posiciones de ahora, aunque nada se mueva.
      invalidate();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (frame) cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      canvas.removeEventListener("wheel", onWheel);
      for (const robot of robots.values()) robot.dispose();
      robots.clear();
      stage.dispose();
      depth.dispose();
      leaderGeometry.dispose();
      leaderMat.dispose();
      environment?.dispose();
      renderer.dispose();
      canvas.remove();
    },
  };

  schedule();
  return api;
}
