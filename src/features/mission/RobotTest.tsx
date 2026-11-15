import { useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import suelos from "../../data/sueloReal.json";
import { compassOf, fetchCurrentWeather } from "../../services/weather";
import type { CurrentWeather } from "../../services/weather";
import { decimal } from "../world/format";
import { matchPercent } from "../world/hierarchy";
import { ROCK_COVER, ROCK_SIZE, SURFACES, VEGETATION, readingOf } from "../world/terrainReading";
import type { TerrainReading } from "../world/terrainReading";
import { useSlipTables } from "../world/useWheelLab";
import { activeObstacles, layoutCamp, rockField } from "./camp";
import type { CampLayout, Rock } from "./camp";
import type { RobotTestResult } from "./campaign";
import { collisionRadius, distanceTo, easyHeading, lookup, meshSampler, slopeAlong, startDrive, steerToward, stepManual } from "./drive";
import type { DriveControls, DriveState, HeightAt, ManualVehicle, Obstacle, SlipTable } from "./drive";
import { GROUND_CREDIT, surfaceFor } from "./groundTextures";
import { MINI_RANGES, drawMini } from "./minimap";
import { RobotCatalog } from "./RobotCatalog";
import { buildRobot } from "./robotModels";
import type { RobotShape } from "./robotModels";
import { robotOfVehicle } from "./robots";
import type { RobotEntry } from "./robots";
import { CAMERA_MODES, createRobotScene, defaultQuality } from "./robotScene";
import type { CameraMode, Quality, RobotScene, ScenePose, TerrainLayer, TrackStyle } from "./robotScene";
import { SATELLITE_CREDIT, fetchSatellite } from "./satellite";
import { lightLabel, weatherSky } from "./sky";
import { rankSpots } from "./spots";
import type { Spot } from "./spots";
import { DAYLIGHT_MIN_DEG, clock, sceneLight, solarHour, sunPosition } from "./sun";
import { CLASS_RGB, slopeCanvas } from "./terrainTexture";
import { TERRAIN_SOURCE, fetchTerrain, offsetToLatLon } from "./twin";
import type { TerrainGrid } from "./twin";
import { EARTH_SOILS, SLIP_LIMIT, soilById, suggestSoil, vehicleById } from "./wheelData";
import type { SoilId, Texture, VehicleId, VehiclePreset } from "./wheelData";
import { tableLimits } from "./wheelLab";
import "./simulador.css";

/** El área del lugar (18 km) y la resolución de su relieve: un dato cada 30 m. */
const AREA_M = 18_000;
const CELLS = 600;
const SUGGESTED = 3;
/** Cuánto se acelera el tiempo. Los resultados se dan siempre en tiempo real. */
const SPEEDS = [1, 2, 10, 30, 60, 200] as const;
/** Velocidad aparente que resulta cómoda de conducir, m/s: de ella sale la aceleración inicial. */
const COMFORT_SPEED = 3;
/** Cada cuánto se dibuja un tramo de huella, m. */
const TRACK_STEP_M = 0.5;
/** A esta distancia del destino se da por alcanzado, m. */
const ARRIVE_M = 1.5;
/** El robot no se acerca más que esto al borde del área, m. */
const EDGE_MARGIN_M = 60;
/** Avance máximo por paso de cálculo, m: los choques no se saltan ningún obstáculo. */
const MAX_ADVANCE_M = 0.3;
/** Con la calidad media se reparte esta parte de las piedras pequeñas y de las matas. */
const MEDIUM_DETAIL = 0.45;
/** Puntos del camino recorrido que guarda el minimapa (uno cada medio metro). */
const TRAIL_POINTS = 6000;
/** Cada cuánto se redibuja el minimapa, s. */
const MINI_EVERY_S = 0.1;
/** Lado del minimapa en pantalla, px: lo fija la hoja de estilos; aquí solo se lee. */
const MINI_FALLBACK_PX = 184;
/** Aire que se deja entre el robot y los datos de abajo, px. */
const HUD_MARGIN_PX = 24;

const textures = suelos.sites as Record<string, Texture | null>;

interface Props {
  site: { id: string; name: string; latitude: number; longitude: number };
  /** Descriptores de la región lunar; null si la comparación es una demostración (Marte). */
  reference: { name: string; relief: number; slope: number; roughness: number } | null;
  added: RobotTestResult | null;
  onAdd: (result: RobotTestResult) => void;
  /** Cierra el centro de misión entero. */
  onClose: () => void;
  /** true si el suelo del lugar está mojado: se ve más oscuro y brillante, y las ruedas no levantan polvo. */
  wet?: boolean;
}

type Load<T> = { status: "cargando" } | { status: "error" } | { status: "listo"; value: T };
type Point = { east: number; north: number };
type Section = "lugar" | "robot" | "suelo" | "vista";
type DriveKey = "up" | "down" | "left" | "right";
interface Hud {
  state: DriveState;
  /** Velocidad real sobre el terreno, m/s. */
  speed: number;
}

const KEYS: Record<string, DriveKey> = {
  arrowup: "up",
  w: "up",
  arrowdown: "down",
  s: "down",
  arrowleft: "left",
  a: "left",
  arrowright: "right",
  d: "right",
};

const CAMERA_NAMES: Record<CameraMode, string> = { seguir: "Seguir", robot: "Cámara del robot", libre: "Libre", cenital: "Cenital", area: "Área" };
/** Qué hace cada cámara, para quien deja el ratón encima. */
const CAMERA_HINTS: Record<CameraMode, string> = {
  seguir: "Detrás del robot, mirando el terreno que tiene delante",
  robot: "Lo que ve el robot desde su mástil; arrastra para mirar a los lados",
  libre: "Alrededor del robot: arrastra para girar y usa la rueda para acercarte",
  cenital: "Desde arriba",
  area: "Los 18 km del lugar",
};

const shapeOf = (vehicle: VehiclePreset): RobotShape => {
  const model = robotOfVehicle(vehicle.id).model;
  return {
    kind: vehicle.id,
    wheelRadius: vehicle.wheel.radius,
    wheelWidth: vehicle.wheel.width,
    body: vehicle.body,
    modelUrl: model?.kind === "nasa" ? model.url : null,
  };
};

const manualOf = (vehicle: VehiclePreset): ManualVehicle => ({
  wheels: vehicle.wheels,
  wheelRadius: vehicle.wheel.radius,
  wheelSpeed: vehicle.wheelSpeed,
  radius: collisionRadius(vehicle.body.length, vehicle.body.width),
  turnRadius: vehicle.turnRadius,
  wheelbase: vehicle.body.wheelbase,
  track: vehicle.body.track,
});

const poseOf = (state: DriveState): ScenePose => ({
  east: state.east,
  north: state.north,
  dx: state.dx,
  dy: state.dy,
  sinkage: state.sinkage,
  wheelAngle: state.wheelAngle,
  slip: state.slip,
});

/** La aceleración del tiempo con la que el robot se ve avanzar a unos 3 m/s. */
const defaultSpeed = (vehicle: VehiclePreset): number =>
  SPEEDS.reduce((best, value) => (Math.abs(value - COMFORT_SPEED / vehicle.wheelSpeed) < Math.abs(best - COMFORT_SPEED / vehicle.wheelSpeed) ? value : best));

/** Color de la huella según el patinaje, con las mismas clases que el terreno (RGB 0-1). */
const trackColor = (slip: number) =>
  CLASS_RGB[slip > SLIP_LIMIT ? "stuck" : slip > SLIP_LIMIT / 2 ? "steep" : "ok"].map((v) => v / 255) as [number, number, number];
const cssColor = (rgb: readonly number[]) => `rgb(${rgb.join(",")})`;

/** Semilla repetible a partir de un texto: el mismo punto da siempre el mismo campo de práctica. */
function seedOf(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return hash >>> 0;
}

function duration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ${Math.round(seconds % 60)} s`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

const speedText = (metersPerSecond: number) =>
  metersPerSecond < 0.5 ? `${decimal(metersPerSecond * 100, 1)} cm/s` : `${decimal(metersPerSecond * 3.6, 1)} km/h`;

const isSmallScreen = () => typeof window !== "undefined" && window.matchMedia("(max-width: 760px)").matches;

/**
 * Simulador de la prueba del robot, a pantalla completa: el relieve real del lugar en 3D, con su
 * imagen satelital, la luz del Sol y el tiempo de ahora; un robot del catálogo que se conduce con
 * el teclado o con un clic, y el modelo rueda-suelo que decide cuánto patina, se hunde y gasta.
 */
export function RobotTest({ site, reference, added, onAdd, onClose, wet = false }: Props) {
  const suggestion = suggestSoil(textures[site.id] ?? null);
  /** Lo que una IA vio en las fotos del lugar: qué cubre el suelo, cuántas rocas hay y de qué tamaño. */
  const reading = readingOf(site.id);
  const rocksFromPhotos = reading !== null && reading.rockCover !== null;
  const rockPhotos = reading ? reading.closePhotos || reading.usefulPhotos : 0;
  const [terrain, setTerrain] = useState<Load<TerrainGrid>>({ status: "cargando" });
  const [attempt, setAttempt] = useState(0);
  const [spots, setSpots] = useState<Spot[]>([]);
  const [spotIndex, setSpotIndex] = useState(0);
  const [imagery, setImagery] = useState<"cargando" | "listo" | "error">("cargando");
  const [weather, setWeather] = useState<CurrentWeather | null | "error">(null);
  const [realNight, setRealNight] = useState(false);
  const [vehicleId, setVehicleId] = useState<VehicleId>("viper");
  /** true: modelo oficial de NASA; false: forma simplificada; null: aún cargando. */
  const [official, setOfficial] = useState<boolean | null>(null);
  const [soilId, setSoilId] = useState<SoilId>(suggestion.id);
  const [layer, setLayer] = useState<TerrainLayer>("satelite");
  const [contours, setContours] = useState(false);
  const [rocksOn, setRocksOn] = useState(true);
  const [quality, setQuality] = useState<Quality>(defaultQuality);
  /** true si la calidad se bajó sola porque la imagen iba a trompicones. */
  const [lowered, setLowered] = useState(false);
  const [trackStyle, setTrackStyle] = useState<TrackStyle>("surco");
  const [miniRange, setMiniRange] = useState(0);
  const [cameraMode, setCameraMode] = useState<CameraMode>("seguir");
  const [speed, setSpeed] = useState<number>(() => defaultSpeed(vehicleById("viper")));
  const [section, setSection] = useState<Section | null>("lugar");
  const [panelOpen, setPanelOpen] = useState(() => !isSmallScreen());
  const [catalog, setCatalog] = useState(false);
  const [help, setHelp] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [auto, setAuto] = useState(false);
  const [target, setTarget] = useState<Point | null>(null);
  const [hud, setHud] = useState<Hud | null>(null);
  const [result, setResult] = useState<RobotTestResult | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [now] = useState(() => new Date());
  /** Pantalla táctil o pequeña: se conduce con los mandos de la pantalla. */
  const [touch] = useState(() => typeof window !== "undefined" && window.matchMedia("(pointer: coarse), (max-width: 760px)").matches);

  const vehicle = vehicleById(vehicleId);
  const robotEntry = robotOfVehicle(vehicleId);
  const soil = soilById(soilId);
  const tables = useSlipTables(vehicleId, soilId);
  const grid = terrain.status === "listo" ? terrain.value : null;

  const rootRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  /** Lo que tapa el lienzo por arriba (avisos y, en el teléfono, el minimapa) y por abajo (los datos). */
  const chipsRef = useRef<HTMLDivElement>(null);
  const middleRef = useRef<HTMLDivElement>(null);
  const hudRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<RobotScene | null>(null);
  const heightRef = useRef<HeightAt | null>(null);
  const driveRef = useRef<DriveState | null>(null);
  const startRef = useRef<Point>({ east: 0, north: 0 });
  const targetRef = useRef<Point | null>(null);
  const tablesRef = useRef<{ earth: SlipTable; moon: SlipTable } | null>(null);
  const vehicleRef = useRef(vehicle);
  const soilRef = useRef(soil);
  const speedRef = useRef(speed);
  const cameraRef = useRef(cameraMode);
  const autoRef = useRef(false);
  const placingRef = useRef(false);
  const finishedRef = useRef(false);
  const overlayRef = useRef(false);
  const rocksRef = useRef(rocksOn);
  const campRef = useRef<CampLayout | null>(null);
  /** Con qué punto y rumbo se repartió el campo: al cambiar la calidad se reparte igual. */
  const campSpecRef = useRef<{ start: Point; facing: number } | null>(null);
  /** Las rocas que detienen al robot: las que enseña el minimapa. */
  const solidRocksRef = useRef<Rock[]>([]);
  const obstaclesRef = useRef<Obstacle[]>([]);
  const qualityRef = useRef(quality);
  const miniRef = useRef<HTMLCanvasElement>(null);
  const miniRangeRef = useRef(miniRange);
  /** Camino recorrido, para el minimapa: este, norte, este, norte… */
  const trailRef = useRef<number[]>([]);
  /** Imágenes del área para el fondo del minimapa. */
  const satelliteRef = useRef<HTMLCanvasElement | null>(null);
  const slopeRef = useRef<HTMLCanvasElement | null>(null);
  const layerRef = useRef(layer);
  /** Se pone a true cuando cambia algo de lo que el minimapa muestra. */
  const miniStaleRef = useRef(true);
  const keysRef = useRef<Record<DriveKey, boolean>>({ up: false, down: false, left: false, right: false });
  const smoothRef = useRef<DriveControls>({ throttle: 0, steer: 0 });
  /** Cómo se condujo la prueba, para decirlo en el resultado. */
  const usedRef = useRef({ manual: false, auto: false });
  const lastTrackRef = useRef(0);

  useEffect(() => {
    tablesRef.current = tables;
    vehicleRef.current = vehicle;
    soilRef.current = soil;
    speedRef.current = speed;
    cameraRef.current = cameraMode;
    placingRef.current = placing;
    overlayRef.current = catalog || help;
    rocksRef.current = rocksOn;
    qualityRef.current = quality;
    if (miniRangeRef.current !== miniRange || layerRef.current !== layer) miniStaleRef.current = true;
    miniRangeRef.current = miniRange;
    layerRef.current = layer;
  });

  /**
   * Reparte la base, las rocas y las matas alrededor del punto de partida. Cuántas rocas hay y de
   * qué tamaño sale de la lectura de fotos del lugar; sin ella, son rocas de práctica. Con `facing`
   * se repite un reparto anterior (al cambiar la calidad); sin él, la base va delante del robot.
   */
  function layCamp(start: Point, facing?: number) {
    const height = heightRef.current;
    if (!height) return;
    const state = driveRef.current;
    const spec = { start, facing: facing ?? (state ? Math.atan2(state.dy, state.dx) : Math.PI / 2) };
    campSpecRef.current = spec;
    const field = rockField(reading, qualityRef.current === "alta" ? 1 : MEDIUM_DETAIL);
    const layout = layoutCamp(start, height, seedOf(`${site.id}:${Math.round(start.east)}:${Math.round(start.north)}`), spec.facing, field);
    campRef.current = layout;
    solidRocksRef.current = layout.rocks.filter((rock) => rock.solid);
    obstaclesRef.current = activeObstacles(layout, rocksRef.current);
    miniStaleRef.current = true;
    sceneRef.current?.setCamp(layout, rocksRef.current);
  }

  /** Pone el robot en `start`, mirando hacia el rumbo más llano, y empieza una prueba nueva. */
  function restart(start: Point, keepTarget = false) {
    startRef.current = start;
    const height = heightRef.current;
    const facing = height ? easyHeading(height, start.east, start.north) : Math.PI / 2;
    const state = startDrive(start.east, start.north, start.east + Math.cos(facing), start.north + Math.sin(facing));
    if (height) state.slope = slopeAlong(height, start.east, start.north, state.dx, state.dy);
    driveRef.current = state;
    finishedRef.current = false;
    autoRef.current = false;
    usedRef.current = { manual: false, auto: false };
    smoothRef.current = { throttle: 0, steer: 0 };
    lastTrackRef.current = 0;
    trailRef.current = [start.east, start.north];
    miniStaleRef.current = true;
    const nextTarget = keepTarget ? targetRef.current : null;
    targetRef.current = nextTarget;
    setAuto(false);
    setTarget(nextTarget);
    setHud({ state, speed: 0 });
    setResult(null);
    setNotice(null);
    const scene = sceneRef.current;
    if (!scene) return;
    scene.clearTrack();
    scene.setTarget(nextTarget);
    scene.setPose(poseOf(state));
  }

  /** Lleva el robot a otro punto de partida, con su campo de práctica. */
  function moveTo(start: Point) {
    restart(start);
    layCamp(start);
    sceneRef.current?.setCamera(cameraRef.current);
  }

  /** Cierra la prueba y guarda su resultado. */
  function finish(outcome: "llego" | "atascado", reachedTarget: boolean) {
    const state = driveRef.current;
    if (!state) return;
    finishedRef.current = true;
    autoRef.current = false;
    setAuto(false);
    const point = (east: number, north: number) => {
      const at = offsetToLatLon(site.latitude, site.longitude, east, north);
      return { latitude: Number(at.latitude.toFixed(6)), longitude: Number(at.longitude.toFixed(6)) };
    };
    const used = usedRef.current;
    setHud({ state, speed: 0 });
    setResult({
      vehicle: vehicleRef.current.name,
      soil: soilRef.current.name,
      start: point(startRef.current.east, startRef.current.north),
      end: point(state.east, state.north),
      outcome,
      distanceM: Math.round(state.distance * 10) / 10,
      timeS: Math.round(state.time),
      energyWh: Math.round((state.energy / 3600) * 10) / 10,
      maxSlopeDeg: Math.round(state.maxSlope * 10) / 10,
      maxSlipPercent: Math.round(state.maxSlip * 100),
      mode: used.manual && used.auto ? "mixto" : used.auto ? "piloto" : "manual",
      reachedTarget,
      collisions: state.collisions,
      stuckTimes: state.stuckTimes,
    });
  }

  // ---------- La escena: se crea una vez ----------
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const scene = createRobotScene(container, { calm: window.matchMedia("(prefers-reduced-motion: reduce)").matches, quality: qualityRef.current });
    sceneRef.current = scene;
    rootRef.current?.focus();
    let sinceHud = 0;
    let sinceMini = MINI_EVERY_S;
    let painted: DriveState | null = null;

    // Si con la calidad alta la imagen va a trompicones, se baja sola y se avisa.
    scene.onSlow = () => {
      setQuality("media");
      setLowered(true);
    };

    /** Redibuja el minimapa con lo que el robot tiene ahora alrededor. */
    const paintMini = (state: DriveState) => {
      const canvas = miniRef.current;
      const context = canvas?.getContext("2d");
      if (!canvas || !context) return;
      const side = canvas.clientWidth || MINI_FALLBACK_PX;
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      const pixels = Math.round(side * ratio);
      if (canvas.width !== pixels) {
        canvas.width = pixels;
        canvas.height = pixels;
      }
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      const camp = campRef.current;
      drawMini(
        context,
        { east: state.east, north: state.north, heading: Math.atan2(state.dy, state.dx), rangeM: MINI_RANGES[miniRangeRef.current], sizePx: side },
        {
          background: layerRef.current === "pendiente" ? slopeRef.current : satelliteRef.current,
          areaM: AREA_M,
          trail: trailRef.current,
          rocks: rocksRef.current ? solidRocksRef.current : [],
          modules: camp ? camp.items.filter((item) => item.radius > 0) : [],
          base: camp?.base ?? null,
          target: targetRef.current,
        },
      );
    };

    scene.onPick = (east, north) => {
      const limit = AREA_M / 2 - EDGE_MARGIN_M;
      const point = { east: Math.min(limit, Math.max(-limit, east)), north: Math.min(limit, Math.max(-limit, north)) };
      if (placingRef.current) {
        placingRef.current = false;
        setPlacing(false);
        moveTo(point);
        return;
      }
      if (finishedRef.current || !driveRef.current) return;
      // Un clic marca el destino y el robot va solo hacia él.
      targetRef.current = point;
      miniStaleRef.current = true;
      autoRef.current = true;
      usedRef.current.auto = true;
      setTarget(point);
      setAuto(true);
      setNotice(null);
      scene.setTarget(point);
    };

    scene.onFrame = (dt) => {
      const state = driveRef.current;
      // El minimapa se redibuja unas diez veces por segundo, y solo si algo cambió.
      sinceMini += dt;
      if (state && sinceMini >= MINI_EVERY_S && (miniStaleRef.current || state !== painted || sinceMini >= 0.5)) {
        sinceMini = 0;
        miniStaleRef.current = false;
        painted = state;
        paintMini(state);
      }
      const table = tablesRef.current?.earth;
      const height = heightRef.current;
      if (!state || !table || !height || finishedRef.current) return;
      const keys = keysRef.current;
      const wanted = { throttle: (keys.up ? 1 : 0) - (keys.down ? 1 : 0), steer: (keys.left ? 1 : 0) - (keys.right ? 1 : 0) };
      const driving = wanted.throttle !== 0 || wanted.steer !== 0;
      if (driving) {
        usedRef.current.manual = true;
        if (autoRef.current) {
          // Cualquier mando devuelve el control a quien conduce.
          autoRef.current = false;
          setAuto(false);
        }
      }
      // Los mandos del teclado son todo o nada: se suavizan para que el robot no dé tirones.
      const smooth = smoothRef.current;
      smooth.throttle += (wanted.throttle - smooth.throttle) * Math.min(1, dt * 9);
      smooth.steer += (wanted.steer - smooth.steer) * Math.min(1, dt * 7);
      if (Math.abs(smooth.throttle) < 0.02 && wanted.throttle === 0) smooth.throttle = 0;
      if (Math.abs(smooth.steer) < 0.02 && wanted.steer === 0) smooth.steer = 0;
      const aim = targetRef.current;
      const piloted = autoRef.current && aim !== null;
      if (!piloted && smooth.throttle === 0 && smooth.steer === 0 && state.motion === "parado") return;

      const manual = manualOf(vehicleRef.current);
      const limit = AREA_M / 2 - EDGE_MARGIN_M;
      const maxStep = Math.min(0.5, MAX_ADVANCE_M / manual.wheelSpeed);
      let left = dt * speedRef.current;
      let next = state;
      let arrived = false;
      while (left > 1e-6) {
        const step = Math.min(maxStep, left);
        const controls = piloted && aim ? steerToward(next, manual, aim.east, aim.north) : smooth;
        next = stepManual(next, step, height, table, manual, controls, obstaclesRef.current, limit);
        left -= step;
        if (next.distance - lastTrackRef.current >= TRACK_STEP_M) {
          scene.addTrack(poseOf(next), trackColor(next.slip));
          lastTrackRef.current = next.distance;
          const trail = trailRef.current;
          trail.push(next.east, next.north);
          if (trail.length > TRAIL_POINTS * 2) trail.splice(0, trail.length - TRAIL_POINTS * 2);
        }
        if (aim && distanceTo(next, aim.east, aim.north) <= ARRIVE_M) {
          arrived = true;
          break;
        }
        if (piloted && (next.status === "atascado" || next.touching)) break;
      }
      driveRef.current = next;
      scene.setPose(poseOf(next));
      const simulated = dt * speedRef.current - left;
      const speedNow = simulated > 0 ? (next.distance - state.distance) / simulated : 0;

      if (arrived) {
        finish("llego", true);
        return;
      }
      if (piloted && next.status === "atascado") {
        // El piloto automático no sabe salir de un atasco: la prueba termina ahí, como resultado.
        finish("atascado", false);
        return;
      }
      if (piloted && next.touching) {
        autoRef.current = false;
        setAuto(false);
        setNotice("Hay un obstáculo en el camino: rodéalo con las flechas.");
      }
      sinceHud += dt;
      // Los datos se refrescan unas ocho veces por segundo, y siempre que el robot cambia de estado
      // (se para, se topa, se atasca): si no, quedaría en pantalla una velocidad que ya no tiene.
      const changed = next.motion !== state.motion || next.status !== state.status || next.touching !== state.touching;
      if (sinceHud > 0.12 || changed) {
        sinceHud = 0;
        setHud({ state: next, speed: next.touching || next.status === "atascado" ? 0 : speedNow });
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      const root = rootRef.current;
      const active = document.activeElement;
      if (!root || overlayRef.current) return;
      if (active && active !== document.body && !root.contains(active)) return;
      if (active instanceof HTMLSelectElement || active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const key = event.key.toLowerCase();
      const drive = KEYS[key];
      if (drive) {
        keysRef.current[drive] = true;
        event.preventDefault();
        return;
      }
      if (event.repeat) return;
      if (key === "c") setCameraMode((mode) => CAMERA_MODES[(CAMERA_MODES.indexOf(mode) + 1) % CAMERA_MODES.length]);
      else if (key === "r") restart(startRef.current);
      else if (key === " " && !(active instanceof HTMLButtonElement)) {
        event.preventDefault();
        autoRef.current = false;
        setAuto(false);
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      const drive = KEYS[event.key.toLowerCase()];
      if (drive) keysRef.current[drive] = false;
    };
    const release = () => {
      keysRef.current = { up: false, down: false, left: false, right: false };
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", release);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", release);
      scene.dispose();
      sceneRef.current = null;
    };
    // La escena vive mientras el simulador está abierto; lo que cambia se le pasa por referencias.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // La imagen se centra en lo que queda a la vista entre los avisos de arriba y los datos de abajo:
  // se mide cuánto tapan y se le dice a la escena cada vez que cambian de tamaño.
  useEffect(() => {
    const root = rootRef.current;
    const hudBox = hudRef.current;
    if (!root || !hudBox) return;
    const measure = () => {
      const frame = root.getBoundingClientRect();
      // En el teléfono el minimapa va bajo los avisos y también tapa.
      const above = (isSmallScreen() ? middleRef.current : chipsRef.current)?.getBoundingClientRect();
      sceneRef.current?.setInsets(above ? Math.max(0, above.bottom - frame.top) : 0, Math.max(0, frame.bottom - hudBox.getBoundingClientRect().top) + HUD_MARGIN_PX);
    };
    const observer = new ResizeObserver(measure);
    for (const element of [root, hudBox, chipsRef.current, middleRef.current]) if (element) observer.observe(element);
    measure();
    return () => observer.disconnect();
  }, []);

  // ---------- El relieve real del área y los puntos sugeridos ----------
  useEffect(() => {
    let cancelled = false;
    fetchTerrain(site.latitude, site.longitude, AREA_M, CELLS)
      .then((value) => {
        if (cancelled) return;
        const height = meshSampler(value);
        heightRef.current = height;
        sceneRef.current?.setTerrain(value, height);
        const ranked = reference ? rankSpots(value, site.latitude, site.longitude, reference).slice(0, SUGGESTED) : [];
        setSpots(ranked);
        setSpotIndex(0);
        setTerrain({ status: "listo", value });
        moveTo(ranked[0] ? { east: ranked[0].east, north: ranked[0].north } : { east: 0, north: 0 });
      })
      .catch(() => !cancelled && setTerrain({ status: "error" }));
    return () => {
      cancelled = true;
    };
    // `moveTo` solo usa referencias y funciones de estado, que no cambian.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [site.latitude, site.longitude, reference, attempt]);

  // ---------- La imagen satelital ----------
  useEffect(() => {
    let cancelled = false;
    fetchSatellite(site.latitude, site.longitude, AREA_M)
      .then((canvas) => {
        if (cancelled) return;
        satelliteRef.current = canvas;
        miniStaleRef.current = true;
        // Las rocas, el polvo y las huellas toman el tono del suelo de la imagen.
        sceneRef.current?.setImagery(canvas);
        setImagery("listo");
      })
      .catch(() => !cancelled && setImagery("error"));
    return () => {
      cancelled = true;
    };
  }, [site.latitude, site.longitude]);

  // ---------- El tiempo de ahora y la luz ----------
  useEffect(() => {
    let cancelled = false;
    fetchCurrentWeather(site.latitude, site.longitude)
      .then((value) => !cancelled && setWeather(value))
      .catch(() => !cancelled && setWeather("error"));
    return () => {
      cancelled = true;
    };
  }, [site.latitude, site.longitude]);

  const realSun = useMemo(() => sunPosition(now, site.latitude, site.longitude), [now, site.latitude, site.longitude]);
  const light = useMemo(() => sceneLight(now, site.latitude, site.longitude), [now, site.latitude, site.longitude]);
  const nightThere = realSun.elevation < DAYLIGHT_MIN_DEG;
  const currentWeather = weather === "error" ? null : weather;
  useEffect(() => {
    const sunNow = realNight ? realSun : light;
    sceneRef.current?.setSky({ ...weatherSky(currentWeather), elevation: sunNow.elevation, azimuth: sunNow.azimuth });
  }, [currentWeather, realNight, realSun, light]);

  // ---------- El robot ----------
  useEffect(() => {
    let cancelled = false;
    const shape = shapeOf(vehicleById(vehicleId));
    buildRobot(shape).then((built) => {
      const scene = sceneRef.current;
      if (cancelled || !scene) {
        built.dispose();
        return;
      }
      scene.setRobot(built, shape);
      if (driveRef.current) scene.setPose(poseOf(driveRef.current));
      scene.setCamera(cameraRef.current);
      setOfficial(built.official);
    });
    return () => {
      cancelled = true;
    };
  }, [vehicleId]);

  // La capa de pendiente depende del robot y del suelo: qué sube, dónde patina y dónde se atasca.
  const limits = useMemo(() => (tables ? tableLimits(tables.earth, SLIP_LIMIT) : null), [tables]);
  useEffect(() => {
    if (!grid || !limits) return;
    const canvas = slopeCanvas(grid, limits);
    slopeRef.current = canvas;
    miniStaleRef.current = true;
    sceneRef.current?.setSlopeImage(canvas);
  }, [grid, limits]);
  useEffect(() => {
    sceneRef.current?.setLayer(layer);
  }, [layer]);
  useEffect(() => {
    sceneRef.current?.setContours(contours);
  }, [contours]);
  useEffect(() => {
    sceneRef.current?.setCamera(cameraMode);
  }, [cameraMode]);
  useEffect(() => {
    sceneRef.current?.setTrackStyle(trackStyle);
  }, [trackStyle]);

  // El grano del suelo visto de cerca: lo que las fotos del lugar muestran; sin fotos, el suelo elegido.
  const ground = surfaceFor(reading, soilId);
  useEffect(() => {
    sceneRef.current?.setGround(ground.surface, ground.secondary);
  }, [ground.surface, ground.secondary]);

  // Mojado si lo dice quien abre el simulador o si ahora mismo llueve en el lugar.
  const rainingNow = currentWeather !== null && weatherSky(currentWeather).precipitation === "lluvia";
  const wetGround = wet || rainingNow;
  useEffect(() => {
    sceneRef.current?.setWet(wetGround);
  }, [wetGround]);

  useEffect(() => {
    sceneRef.current?.setQuality(quality);
    // Con otra calidad cambian las piedras pequeñas y las matas; las rocas que detienen al robot, no.
    const spec = campSpecRef.current;
    if (spec && campRef.current) layCamp(spec.start, spec.facing);
    // `layCamp` solo usa referencias y la lectura de fotos del lugar, que no cambia.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quality]);

  function chooseSpot(index: number) {
    setSpotIndex(index);
    const spot = spots[index];
    if (spot) moveTo({ east: spot.east, north: spot.north });
  }

  /** Otro robot: se dibuja el nuevo y la prueba vuelve a empezar en el mismo punto. */
  function chooseRobot(robot: RobotEntry) {
    if (!robot.vehicle) return;
    setCatalog(false);
    if (robot.vehicle === vehicleId) return;
    setOfficial(null);
    setVehicleId(robot.vehicle);
    setSpeed(defaultSpeed(vehicleById(robot.vehicle)));
    restart(startRef.current);
  }

  /** Otro suelo: cambian las tablas de patinaje y la prueba vuelve a empezar. */
  function chooseSoil(id: SoilId) {
    setSoilId(id);
    restart(startRef.current);
  }

  function toggleRocks(on: boolean) {
    setRocksOn(on);
    rocksRef.current = on;
    miniStaleRef.current = true;
    if (!campRef.current) return;
    obstaclesRef.current = activeObstacles(campRef.current, on);
    sceneRef.current?.setCamp(campRef.current, on);
  }

  function chooseQuality(next: Quality) {
    setQuality(next);
    setLowered(false);
  }

  function retry() {
    setTerrain({ status: "cargando" });
    setAttempt((n) => n + 1);
  }

  /** Tras un resultado, se puede seguir conduciendo desde donde quedó. */
  function resume() {
    finishedRef.current = false;
    if (result?.reachedTarget) {
      targetRef.current = null;
      miniStaleRef.current = true;
      setTarget(null);
      sceneRef.current?.setTarget(null);
    }
    setResult(null);
  }

  const hold = (key: DriveKey) => ({
    onPointerDown: (event: ReactPointerEvent) => {
      event.preventDefault();
      keysRef.current[key] = true;
    },
    onPointerUp: () => {
      keysRef.current[key] = false;
    },
    onPointerLeave: () => {
      keysRef.current[key] = false;
    },
    onPointerCancel: () => {
      keysRef.current[key] = false;
    },
    onContextMenu: (event: ReactMouseEvent) => event.preventDefault(),
  });

  // ---------- Lo que se muestra ----------
  const state = hud?.state ?? null;
  const ahead = state && tables ? lookup(tables.earth, state.slope) : null;
  const still = !state || state.motion === "parado" || state.motion === "girando";
  // Parado, se anticipa lo que pasará en la pendiente que tiene delante; en marcha, lo que está pasando.
  const slipHere = !state ? 0 : still ? (ahead ? ahead.slip : tables ? 1 : 0) : state.slip;
  const sinkageHere = !state ? 0 : still ? (ahead?.sinkage ?? tables?.earth.climbs.at(-1)?.sinkage ?? 0) : state.sinkage;
  const moonSlip = state && tables && vehicle.world === "luna" ? lookup(tables.moon, state.slope) : null;
  const toTarget = state && target ? distanceTo(state, target.east, target.north) : null;
  const status = !state
    ? "Cargando"
    : result
      ? result.outcome === "atascado"
        ? "Atascado"
        : "Prueba terminada"
      : state.touching
        ? "Obstáculo"
        : state.status === "atascado"
          ? "Atascado"
          : state.motion === "adelante"
            ? auto
              ? "Piloto automático"
              : "Avanzando"
            : state.motion === "atras"
              ? "Marcha atrás"
              : state.motion === "girando"
                ? "Girando"
                : "Listo";
  const hint = !state
    ? "Leyendo el relieve real del lugar…"
    : result
      ? "Prueba terminada: añádela al plan, sigue conduciendo o repítela."
      : placing
        ? "Haz clic en el terreno donde quieras poner el robot."
        : (notice ??
        (state.touching
          ? "Se topó con un obstáculo: gira o retrocede para rodearlo."
          : state.status === "atascado"
            ? "Esta pendiente no la sube: retrocede o cambia de rumbo."
            : auto
              ? "Va solo hacia la bandera. Cualquier mando te devuelve el control."
              : touch
                ? cameraMode === "robot"
                  ? "Vista desde el mástil del robot · desliza para mirar a los lados"
                  : "Mandos en pantalla · toca el terreno para ir a un punto"
                : cameraMode === "robot"
                  ? "Vista desde el mástil del robot · arrastra para mirar a los lados · C cambia de cámara"
                  : "Flechas o W A S D para conducir · clic en el terreno para ir a un punto"));
  const cover = reading?.rockCover ?? null;
  const groundText = `${SURFACES[ground.surface]}${ground.secondary ? ` con ${SURFACES[ground.secondary]}` : ""}`;
  const clockThere = currentWeather?.time.slice(11, 16) || clock(solarHour(now, site.longitude));
  const weatherText = currentWeather
    ? `${currentWeather.description} · ${decimal(currentWeather.temperature)} °C · viento de ${decimal(currentWeather.windSpeed)} km/h del ${compassOf(currentWeather.windDirection)}`
    : weather === "error"
      ? "Sin dato del tiempo: cielo despejado de referencia"
      : "Consultando el tiempo de ahora…";

  return (
    <div className={`sim${panelOpen ? "" : " sim-sin-panel"}`} ref={rootRef} tabIndex={-1} aria-label={`Simulador de la prueba del robot en ${site.name}`}>
      <div className="sim-lienzo" ref={containerRef} />

      <div className="sim-barra">
        <div className="sim-lugar">
          <strong>{site.name}</strong>
          <span>
            {robotEntry.name} · {soil.name.toLowerCase()}
          </span>
        </div>
        <div className="sim-grupo" role="group" aria-label="Cómo se pinta el terreno">
          <button type="button" aria-pressed={layer === "satelite"} onClick={() => setLayer("satelite")}>
            Satélite
          </button>
          <button type="button" aria-pressed={layer === "pendiente"} onClick={() => setLayer("pendiente")}>
            Pendiente
          </button>
        </div>
        <button type="button" className="sim-boton" aria-pressed={contours} onClick={() => setContours((on) => !on)}>
          Curvas de nivel
        </button>
        <div className="sim-grupo" role="group" aria-label="Cámara">
          {CAMERA_MODES.map((mode) => (
            <button key={mode} type="button" aria-pressed={cameraMode === mode} title={CAMERA_HINTS[mode]} onClick={() => setCameraMode(mode)}>
              {CAMERA_NAMES[mode]}
            </button>
          ))}
        </div>
        <button type="button" className="sim-icono" aria-label="Ayuda: cómo se conduce y qué es real" onClick={() => setHelp(true)}>
          ?
        </button>
        <button type="button" className="sim-icono" aria-label="Cerrar el centro de misión" onClick={onClose}>
          ✕
        </button>
      </div>

      {/* Todo lo de arriba a la izquierda va en una columna: si los avisos ocupan dos filas, lo demás baja. */}
      <div className="sim-arriba">
      <div className="sim-ahora" ref={chipsRef}>
        <span className="sim-chip" title="Tiempo de ahora en el lugar, de Open-Meteo">
          <b>Ahora allí</b> {weatherText}
        </span>
        <span className="sim-chip">
          {lightLabel(light, realNight, clockThere)}
          {nightThere && (
            <button type="button" onClick={() => setRealNight((on) => !on)}>
              {realNight ? "Ver con luz de día" : "Ver la noche real"}
            </button>
          )}
        </span>
        <span className="sim-chip">
          {rocksFromPhotos
            ? `Rocas según la lectura de ${rockPhotos} ${rockPhotos === 1 ? "foto" : "fotos"} · base de ejemplo`
            : "Rocas y base: de práctica, no son del lugar"}
          <button type="button" onClick={() => setHelp(true)}>
            ¿Qué es real?
          </button>
        </span>
        {wetGround && <span className="sim-chip">Suelo mojado{rainingNow ? ": llueve ahora" : ""} · sin polvo</span>}
        {lowered && (
          <span className="sim-chip aviso" role="status">
            La imagen iba lenta: se bajó la calidad a Media.
            <button
              type="button"
              onClick={() => {
                setPanelOpen(true);
                setSection("vista");
              }}
            >
              Cambiar
            </button>
          </span>
        )}
        {terrain.status === "error" && (
          <span className="sim-chip aviso" role="alert">
            No se pudo leer la elevación del lugar.
            <button type="button" onClick={retry}>
              Reintentar
            </button>
          </span>
        )}
        {terrain.status === "cargando" && <span className="sim-chip">Leyendo el relieve real de los 18 km…</span>}
        {imagery === "error" && <span className="sim-chip aviso">Sin imagen satelital: el terreno se ve sin color.</span>}
      </div>

      <div className="sim-medio" ref={middleRef}>
        <div className="sim-medio-izq">
          <button type="button" className="sim-ajustes" aria-expanded={panelOpen} onClick={() => setPanelOpen((open) => !open)}>
            {panelOpen ? "Ocultar ajustes" : "Lugar, robot y suelo"}
          </button>
          {layer === "pendiente" && limits && (
            <ul className="sim-leyenda">
              <li>
                <i style={{ background: cssColor(CLASS_RGB.ok) }} />
                Sube con poco patinaje (menos de {decimal(limits.steep, 1)}°)
              </li>
              <li>
                <i style={{ background: cssColor(CLASS_RGB.steep) }} />
                Patina más del {decimal(SLIP_LIMIT * 100)} %
              </li>
              <li>
                <i style={{ background: cssColor(CLASS_RGB.stuck) }} />
                Se atasca (desde {decimal(limits.stuck, 1)}°)
              </li>
            </ul>
          )}
        </div>
        <div className="sim-mini">
          <canvas
            ref={miniRef}
            role="img"
            aria-label="Minimapa: el robot visto desde arriba, con las rocas, la base, el destino y el camino recorrido. Lo que tiene delante queda arriba."
            title="Lo que el robot tiene delante queda arriba. Clic para cambiar el alcance."
            onClick={() => setMiniRange((index) => (index + 1) % MINI_RANGES.length)}
          />
          <span className="sim-mini-pie">↑ delante</span>
          <div className="sim-mini-zoom">
            <button type="button" aria-label="Acercar el minimapa" disabled={miniRange === 0} onClick={() => setMiniRange((index) => Math.max(0, index - 1))}>
              +
            </button>
            <button
              type="button"
              aria-label="Alejar el minimapa"
              disabled={miniRange === MINI_RANGES.length - 1}
              onClick={() => setMiniRange((index) => Math.min(MINI_RANGES.length - 1, index + 1))}
            >
              −
            </button>
          </div>
        </div>
      </div>
      {panelOpen && (
        <aside className="sim-panel" aria-label="Lugar, robot y suelo">
          <section className={section === "lugar" ? "abierta" : undefined}>
            <h3>
              <button type="button" aria-expanded={section === "lugar"} onClick={() => setSection(section === "lugar" ? null : "lugar")}>
                <b>1</b> Dónde colocarlo
                <small>{spots.length ? `Punto ${spotIndex + 1}` : "Centro del área"}</small>
              </button>
            </h3>
            {section === "lugar" && (
              <div className="sim-paso">
                {!reference ? (
                  <p>Marte es una demostración: el robot empieza en el centro del área.</p>
                ) : terrain.status !== "listo" ? (
                  <p>Buscando los cuadros de 3 km que más se parecen a {reference.name}…</p>
                ) : (
                  <>
                    <p>Los cuadros de 3 km del área con mayor coincidencia de terreno con {reference.name}:</p>
                    <ol className="sim-puntos">
                      {spots.map((spot, index) => (
                        <li key={`${spot.east},${spot.north}`}>
                          <button type="button" aria-pressed={index === spotIndex} onClick={() => chooseSpot(index)}>
                            <strong>
                              Punto {index + 1} <em>{matchPercent(spot.distance)} % de coincidencia</em>
                            </strong>
                            <span>
                              pendiente {decimal(spot.slope, 1)}° · relieve {decimal(spot.relief)} m
                            </span>
                            <small>
                              {spot.latitude.toFixed(4)}, {spot.longitude.toFixed(4)}
                            </small>
                          </button>
                        </li>
                      ))}
                    </ol>
                  </>
                )}
                <button type="button" className="sim-boton" aria-pressed={placing} disabled={!state} onClick={() => setPlacing((on) => !on)}>
                  {placing ? "Haz clic en el terreno…" : "Ponerlo en otro sitio"}
                </button>
              </div>
            )}
          </section>

          <section className={section === "robot" ? "abierta" : undefined}>
            <h3>
              <button type="button" aria-expanded={section === "robot"} onClick={() => setSection(section === "robot" ? null : "robot")}>
                <b>2</b> Robot
                <small>{robotEntry.name}</small>
              </button>
            </h3>
            {section === "robot" && (
              <div className="sim-paso">
                <p className="sim-robot-tipo">
                  <strong>{robotEntry.name}</strong> {robotEntry.type} · {robotEntry.group.toLowerCase()}
                </p>
                <dl className="sim-robot-datos">
                  <div>
                    <dt>Masa</dt>
                    <dd>{decimal(vehicle.mass)} kg</dd>
                  </div>
                  <div>
                    <dt>Ruedas</dt>
                    <dd>
                      {vehicle.wheels} de {decimal(vehicle.wheel.radius * 200, 1)} × {decimal(vehicle.wheel.width * 100, 1)} cm
                    </dd>
                  </div>
                  <div>
                    <dt>Rueda a</dt>
                    <dd>{speedText(vehicle.wheelSpeed)}</dd>
                  </div>
                </dl>
                <p>
                  {vehicle.turnNote}. Se prueba con su masa real, como recomienda el estudio con NASA de 2025
                  {vehicle.world === "marte" ? "; es un robot de Marte, aquí con la gravedad de la Tierra." : "."}
                </p>
                <p className="sim-credito">
                  {official === null
                    ? "Cargando el modelo 3D…"
                    : official && robotEntry.model?.kind === "nasa"
                      ? `${robotEntry.model.credit}.`
                      : robotEntry.model?.kind === "nasa"
                        ? "No se pudo cargar el modelo oficial: se muestra una forma simplificada."
                        : robotEntry.model?.note}
                </p>
                <button type="button" className="nc-btn primario compacto" onClick={() => setCatalog(true)}>
                  Elegir otro robot del catálogo
                </button>
              </div>
            )}
          </section>

          <section className={section === "suelo" ? "abierta" : undefined}>
            <h3>
              <button type="button" aria-expanded={section === "suelo"} onClick={() => setSection(section === "suelo" ? null : "suelo")}>
                <b>3</b> Suelo y obstáculos
                <small>{soil.name}</small>
              </button>
            </h3>
            {section === "suelo" && (
              <div className="sim-paso">
                <label className="nc-campo">
                  <span>Suelo del lugar</span>
                  <select value={soilId} onChange={(event) => chooseSoil(event.target.value as SoilId)}>
                    {EARTH_SOILS.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                        {suggestion.fromMap && s.id === suggestion.id ? " (sugerido)" : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <p>
                  {soil.detail}.{" "}
                  {suggestion.fromMap
                    ? "El sugerido sale de la textura del mapa mundial SoilGrids; sus parámetros son valores publicados, no medidos aquí."
                    : "El mapa de suelos no tiene dato de este lugar: elige el que más se le parezca."}
                </p>
                <label className="sim-casilla">
                  <input type="checkbox" checked={rocksOn} onChange={(event) => toggleRocks(event.target.checked)} />
                  <span>{cover !== null ? "Rocas" : "Rocas de práctica"}</span>
                </label>
                <p>
                  {cover !== null && reading
                    ? `Según la lectura de ${rockPhotos} ${rockPhotos === 1 ? "foto" : "fotos"} del lugar, ${
                        cover === "ninguna" ? "casi no hay rocas sueltas" : `hay ${ROCK_COVER[cover].name} rocas sueltas`
                      }${reading.rockSize ? `, sobre todo ${ROCK_SIZE[reading.rockSize].name}` : ""}. Es una estimación: dónde está cada roca es al azar. La base de campaña es de ejemplo.`
                    : reading
                      ? "Ninguna foto del lugar muestra el suelo de cerca, así que las rocas son de práctica, como la base de campaña: sirven para maniobrar."
                      : "Las rocas y la base de campaña son de práctica, para maniobrar: los datos del lugar (30 m) no ven rocas."}
                </p>
                <p>
                  De cerca, el suelo se dibuja como {groundText}
                  {ground.fromReading ? ", que es lo que muestran las fotos del lugar" : ", por el suelo elegido"}
                  {reading && reading.vegetation !== "ninguna" ? `, con ${VEGETATION[reading.vegetation]}` : ""}.
                </p>
              </div>
            )}
          </section>

          <section className={section === "vista" ? "abierta" : undefined}>
            <h3>
              <button type="button" aria-expanded={section === "vista"} onClick={() => setSection(section === "vista" ? null : "vista")}>
                <b>4</b> Imagen y huellas
                <small>Calidad {quality}</small>
              </button>
            </h3>
            {section === "vista" && (
              <div className="sim-paso">
                <div className="sim-opcion">
                  <span>Calidad de la imagen</span>
                  <div className="sim-grupo" role="group" aria-label="Calidad de la imagen">
                    <button type="button" aria-pressed={quality === "alta"} onClick={() => chooseQuality("alta")}>
                      Alta
                    </button>
                    <button type="button" aria-pressed={quality === "media"} onClick={() => chooseQuality("media")}>
                      Media
                    </button>
                  </div>
                </div>
                <p>
                  {lowered ? "La imagen iba a trompicones y se bajó a Media. " : ""}
                  Media dibuja menos piedras pequeñas y matas, y sombras más sencillas, para equipos lentos. Las rocas que
                  detienen al robot y los números de la prueba son los mismos.
                </p>
                <div className="sim-opcion">
                  <span>Huellas</span>
                  <div className="sim-grupo" role="group" aria-label="Cómo se pintan las huellas">
                    <button type="button" aria-pressed={trackStyle === "surco"} onClick={() => setTrackStyle("surco")}>
                      Surcos
                    </button>
                    <button type="button" aria-pressed={trackStyle === "patinaje"} onClick={() => setTrackStyle("patinaje")}>
                      Patinaje
                    </button>
                  </div>
                </div>
                <p>
                  {trackStyle === "surco"
                    ? "Surcos del color del suelo; el cordón de tierra de sus bordes crece con el hundimiento que calcula el modelo."
                    : `Cada tramo, pintado con su patinaje: verde, poco; ámbar, más del ${decimal(SLIP_LIMIT * 50)} %; rojo, más del ${decimal(SLIP_LIMIT * 100)} %.`}
                </p>
              </div>
            )}
          </section>
        </aside>
      )}
      </div>

      {result && (
        <div className={`sim-resultado ${result.outcome}`} role="status">
          <strong>
            {result.outcome === "atascado"
              ? `Se atascó a los ${decimal(result.distanceM, 1)} m, en una pendiente de ${decimal(result.maxSlopeDeg, 1)}°`
              : result.reachedTarget
                ? `Llegó al destino: ${decimal(result.distanceM, 1)} m en ${duration(result.timeS)}`
                : `Prueba terminada: ${decimal(result.distanceM, 1)} m en ${duration(result.timeS)}`}
          </strong>
          <span>
            Patinaje máximo {result.maxSlipPercent} % · pendiente máxima {decimal(result.maxSlopeDeg, 1)}° · energía{" "}
            {decimal(result.energyWh, 1)} Wh · {result.collisions} {result.collisions === 1 ? "tope" : "topes"} con obstáculos
          </span>
          <div>
            <button type="button" className="nc-btn primario compacto" onClick={() => onAdd(result)}>
              {added === result ? "Añadida al plan" : "Añadir al plan de campaña"}
            </button>
            <button type="button" className="sim-boton" onClick={resume}>
              Seguir conduciendo
            </button>
            <button type="button" className="sim-boton" onClick={() => restart(startRef.current)}>
              Repetir desde el inicio
            </button>
          </div>
        </div>
      )}

      <div className="sim-mandos" aria-label="Mandos táctiles">
        <div>
          <button type="button" aria-label="Girar a la izquierda" {...hold("left")}>
            ◀
          </button>
          <button type="button" aria-label="Girar a la derecha" {...hold("right")}>
            ▶
          </button>
        </div>
        <div>
          <button type="button" aria-label="Avanzar" {...hold("up")}>
            ▲
          </button>
          <button type="button" aria-label="Marcha atrás" {...hold("down")}>
            ▼
          </button>
        </div>
      </div>

      {/* Un div y no un footer: la hoja de estilos general da formato a todos los footer. */}
      <div className="sim-hud" ref={hudRef} role="group" aria-label="Datos y mandos de la prueba">
        <dl aria-live="off">
          <div className={`sim-estado${state?.touching || state?.status === "atascado" ? " alerta" : ""}`}>
            <dt>Estado</dt>
            <dd>{status}</dd>
          </div>
          <div>
            <dt>Pendiente</dt>
            <dd>
              {state ? `${decimal(Math.abs(state.slope), 1)}°` : "—"}
              <small>{state && state.slope > 0.5 ? " sube" : state && state.slope < -0.5 ? " baja" : ""}</small>
            </dd>
          </div>
          <div>
            <dt>{vehicle.world === "luna" ? "Patinaje · en la Luna" : "Patinaje"}</dt>
            <dd>
              {!tables ? "—" : slipHere >= 1 ? "se atasca" : `${decimal(slipHere * 100)} %`}
              {vehicle.world === "luna" && tables && <small> · {moonSlip ? `${decimal(moonSlip.slip * 100)} %` : "se atasca"}</small>}
            </dd>
          </div>
          <div>
            <dt>Hundimiento</dt>
            <dd>{tables ? `${decimal(sinkageHere * 100, 1)} cm` : "—"}</dd>
          </div>
          <div>
            <dt>Velocidad real</dt>
            <dd>{speedText(hud?.speed ?? 0)}</dd>
          </div>
          <div className="sim-secundario sim-recorrido">
            <dt>Recorrido</dt>
            <dd>
              {decimal(state?.distance ?? 0, 1)} m{toTarget !== null && <small> · a {decimal(toTarget, 1)} m</small>}
            </dd>
          </div>
          <div className="sim-secundario">
            <dt>Tiempo real</dt>
            <dd>{duration(state?.time ?? 0)}</dd>
          </div>
          <div className="sim-secundario">
            <dt>Energía</dt>
            <dd>
              {decimal((state?.energy ?? 0) / 3600, 1)} Wh
              {vehicle.batteryWh ? <small> de {decimal(vehicle.batteryWh)}</small> : null}
            </dd>
          </div>
          <div className="sim-secundario">
            <dt>Topes</dt>
            <dd>{state?.collisions ?? 0}</dd>
          </div>
        </dl>
        <div className="sim-fila">
          <div className="sim-grupo" role="group" aria-label="Aceleración del tiempo">
            {SPEEDS.map((value) => (
              <button key={value} type="button" aria-pressed={speed === value} onClick={() => setSpeed(value)}>
                ×{value}
              </button>
            ))}
          </div>
          <button type="button" className="sim-boton" disabled={!state} onClick={() => restart(startRef.current)}>
            Volver al inicio
          </button>
          <button type="button" className="sim-boton" disabled={!state || Boolean(result) || !state.distance} onClick={() => finish(state?.status === "atascado" ? "atascado" : "llego", false)}>
            Terminar prueba
          </button>
          <p className="sim-pista" role="status">
            {hint}
          </p>
        </div>
      </div>

      {catalog && <RobotCatalog current={robotEntry.id} onPick={chooseRobot} onClose={() => setCatalog(false)} />}

      {help && <SimHelp speed={speed} reading={reading} groundText={groundText} groundFromReading={ground.fromReading} onClose={() => setHelp(false)} />}
    </div>
  );
}

interface HelpProps {
  speed: number;
  /** Lectura de fotos del lugar, si la hay. */
  reading: TerrainReading | null;
  /** Cómo se dibuja el suelo de cerca y si sale de las fotos. */
  groundText: string;
  groundFromReading: boolean;
  onClose: () => void;
}

/** Ayuda del simulador: cómo se conduce, qué es real, qué se estimó con fotos y qué es ilustrativo. */
function SimHelp({ speed, reading, groundText, groundFromReading, onClose }: HelpProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    panelRef.current?.focus();
  }, []);
  return (
    <div className="sim-velo" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div
        className="sim-ayuda"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sim-ayuda-titulo"
        tabIndex={-1}
        ref={panelRef}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          // Cierra solo la ayuda, no el centro de misión.
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }}
      >
      <header>
        <h3 id="sim-ayuda-titulo">Cómo se conduce y qué es real</h3>
        <button type="button" className="sim-icono" aria-label="Cerrar la ayuda" onClick={() => onClose()}>
          ✕
        </button>
      </header>
      <div className="sim-ayuda-cuerpo">
        <section>
          <h4>Conducir</h4>
          <ul>
            <li>
              <kbd>↑</kbd> <kbd>↓</kbd> <kbd>←</kbd> <kbd>→</kbd> o <kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd>: avanzar, marcha atrás y
              girar. Sin acelerar, los robots que pueden giran sobre sí mismos.
            </li>
            <li>Un clic en el terreno marca un destino y el robot va solo. Cualquier flecha te devuelve el mando.</li>
            <li>
              <kbd>C</kbd> cambia la cámara, <kbd>R</kbd> vuelve al inicio y <kbd>Espacio</kbd> detiene el piloto automático.
            </li>
            <li>
              Cámaras: «Seguir» va detrás del robot y mira el terreno que tiene delante; «Cámara del robot» es lo que ve
              desde su mástil (arrastra para mirar a los lados); «Libre» gira a su alrededor. La rueda del ratón acerca
              y aleja. En el móvil hay mandos en pantalla.
            </li>
            <li>
              El minimapa enseña al robot desde arriba, con lo que tiene delante hacia arriba: rocas, base, destino y
              camino recorrido. Con + y − se cambia su alcance.
            </li>
            <li>El tiempo va acelerado (×{speed} ahora) para que el robot no tarde horas; los resultados están en tiempo real.</li>
          </ul>
        </section>
        <section>
          <h4>Qué es real</h4>
          <ul>
            <li>
              El relieve: la elevación real de los 18 km del lugar, con un dato cada 30 m y la altura sin exagerar (
              <a href={TERRAIN_SOURCE.url} target="_blank" rel="noreferrer">
                teselas Terrarium
              </a>
              ).
            </li>
            <li>El color del suelo: imagen de satélite de 10 m por píxel ({SATELLITE_CREDIT}).</li>
            <li>
              La luz y el tiempo: la posición del Sol calculada para este lugar y el tiempo de ahora de{" "}
              <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">
                Open-Meteo
              </a>{" "}
              (CC BY 4.0).
            </li>
            <li>
              Los números: pendiente, patinaje, hundimiento, velocidad, tiempo y energía salen del modelo de rueda y suelo
              de la pestaña «Ruedas», con la masa real del robot y el suelo elegido.
            </li>
            <li>Perseverance y Curiosity: modelos 3D oficiales. Cortesía de NASA/JPL-Caltech; NASA no respalda este proyecto.</li>
          </ul>
        </section>
        <section>
          <h4>Estimado con fotos del lugar</h4>
          <ul>
            {reading ? (
              <>
                <li>
                  Una IA miró {reading.usefulPhotos} {reading.usefulPhotos === 1 ? "foto real tomada" : "fotos reales tomadas"} cerca
                  del lugar (Wikimedia Commons) que muestran el suelo. De ahí sale qué lo cubre ({SURFACES[reading.surface]}
                  {reading.secondary ? ` y ${SURFACES[reading.secondary]}` : ""}) y cuánta vegetación hay ({VEGETATION[reading.vegetation]}
                  ). Confianza {reading.confidence}.
                </li>
                {reading.rockCover !== null ? (
                  <li>
                    Las rocas, según la lectura de {reading.closePhotos || reading.usefulPhotos}{" "}
                    {(reading.closePhotos || reading.usefulPhotos) === 1 ? "foto" : "fotos"} que muestran el suelo de cerca:{" "}
                    {reading.rockCover === "ninguna" ? "casi ninguna roca suelta" : `${ROCK_COVER[reading.rockCover].name} rocas sueltas`}
                    {reading.rockSize ? `, sobre todo ${ROCK_SIZE[reading.rockSize].name}` : ""}. De ahí sale cuántas se
                    reparten y de qué tamaño.
                  </li>
                ) : (
                  <li>Ninguna foto muestra el suelo de cerca: de las rocas no se puede decir nada, así que son de práctica.</li>
                )}
                <li>
                  Es una estimación en clases amplias, no una medición. Por rendimiento se dibujan menos piedras pequeñas
                  de las que habría.
                </li>
              </>
            ) : (
              <li>
                De este lugar no hay fotos que muestren el suelo: las rocas son de práctica y el suelo se dibuja de cerca
                como {groundText}, por el suelo elegido.
              </li>
            )}
          </ul>
        </section>
        <section>
          <h4>Ilustrativo</h4>
          <ul>
            <li>
              Dónde está cada roca y cada mata, y la base de campaña entera: no están en el lugar. Dan escala y sirven
              para maniobrar.
            </li>
            <li>
              El grano del suelo visto de cerca ({groundText}
              {groundFromReading ? "" : ", por el suelo elegido"}): fotografías de materiales parecidos, teñidas con el
              color del satélite. {GROUND_CREDIT}.
            </li>
            <li>
              La forma de las nubes, de la lluvia, de los charcos y del polvo de las ruedas. Cuántas nubes hay y si llueve
              sí siguen al dato real; el polvo crece con el patinaje y no sale con el suelo mojado.
            </li>
            <li>El dibujo de los surcos; su hondura sí sale del hundimiento que calcula el modelo.</li>
            <li>VIPER y el carro lunar: formas simplificadas con sus medidas publicadas; NASA no publica su modelo 3D.</li>
          </ul>
        </section>
        <section>
          <h4>Límites del cálculo</h4>
          <ul>
            <li>La pendiente se mide sobre 10 m: no ve rocas ni zanjas pequeñas del terreno real.</li>
            <li>Bajando no se calcula el frenado: se usan los valores del llano.</li>
            <li>No hay deslizamiento lateral, vuelco ni suspensión. Los parámetros del suelo son valores publicados, no ensayos de este lugar.</li>
          </ul>
        </section>
      </div>
      </div>
    </div>
  );
}
