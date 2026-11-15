/**
 * Catálogo de robots del simulador. Sale del «Catálogo técnico de robots» que preparó el equipo
 * (Excel del 14 de noviembre de 2026: Perseverance, Curiosity, VIPER, DuAxel, EELS y CADRE), con
 * su misma clasificación (tipo, grupo y destino) y sus fuentes de NASA y JPL. Se añade el carro
 * lunar del Apolo, que no está en el Excel: es la única rueda medida en la Luna y con ella se
 * comprueba el cálculo.
 *
 * Un robot se puede simular solo si están publicados su masa, su número de ruedas y el radio y el
 * ancho de la rueda: es lo que pide el modelo rueda-suelo. Lo que no está publicado no se inventa:
 * el robot aparece en el catálogo con el motivo por el que no se puede simular.
 */
import type { Source, VehicleId } from "./wheelData";

export type RobotGroup = "Operativo" | "Planificado" | "Prototipo" | "Histórico";

/** Orden de los grupos en el catálogo, con una frase que los explica. */
export const ROBOT_GROUPS: { id: RobotGroup; detail: string }[] = [
  { id: "Operativo", detail: "Trabajando hoy en otro mundo" },
  { id: "Planificado", detail: "Construidos o en preparación, con misión prevista" },
  { id: "Prototipo", detail: "En desarrollo, sin misión asignada" },
  { id: "Histórico", detail: "Referencia medida en la Luna" },
];

/** De dónde sale la forma 3D de un robot. */
export type RobotModel =
  | { kind: "nasa"; url: string; credit: string; page: string }
  | { kind: "simplificado"; note: string };

export interface RobotEntry {
  id: string;
  name: string;
  /** «Tipo / arquitectura» del catálogo. */
  type: string;
  group: RobotGroup;
  status: string;
  destination: string;
  terrains: string;
  locomotion: string;
  /** Datos publicados; null o texto «No publicado» cuando la fuente no los da. */
  mass: string;
  size: string;
  speed: string;
  slope: string;
  power: string;
  purpose: string;
  source: Source;
  /** Con qué vehículo del modelo rueda-suelo se simula; null si no se puede. */
  vehicle: VehicleId | null;
  /** Por qué no se puede simular, en una frase. */
  blocked: string | null;
  model: RobotModel | null;
}

const NASA_MODEL_NOTE = "Modelo 3D oficial. Cortesía de NASA/JPL-Caltech";
// En las pruebas no hay servidor: la ruta base cae a «/».
const MODELS = `${import.meta.env.BASE_URL ?? "/"}modelos/`;

export const ROBOTS: readonly RobotEntry[] = [
  {
    id: "perseverance",
    name: "Perseverance",
    type: "Rover marciano",
    group: "Operativo",
    status: "Operativo en Marte",
    destination: "Marte (cráter Jezero)",
    terrains: "Rocas, gravas, arena y depósitos sedimentarios",
    locomotion: "6 ruedas, suspensión rocker-bogie",
    mass: "1025 kg",
    size: "3 × 2,7 × 2,2 m",
    speed: "152 m/h como máximo",
    slope: "Diseñado para no volcar hasta 45°; se evita pasar de 30°",
    power: "Generador de radioisótopos (MMRTG), unos 110 W al inicio",
    purpose: "Geología, habitabilidad pasada y recogida de muestras",
    source: { label: "NASA, Perseverance Rover Components", url: "https://science.nasa.gov/mission/mars-2020-perseverance/rover-components/" },
    vehicle: "perseverance",
    blocked: null,
    model: {
      kind: "nasa",
      url: `${MODELS}perseverance.glb`,
      credit: NASA_MODEL_NOTE,
      page: "https://science.nasa.gov/resource/mars-perseverance-rover-3d-model/",
    },
  },
  {
    id: "curiosity",
    name: "Curiosity",
    type: "Rover y laboratorio marciano",
    group: "Operativo",
    status: "Operativo en Marte",
    destination: "Marte (cráter Gale)",
    terrains: "Roca, sedimentos, arenas y laderas",
    locomotion: "6 ruedas, suspensión rocker-bogie",
    mass: "899 kg",
    size: "3 × 2,7 × 2,2 m",
    speed: "144 m/h como máximo",
    slope: "No publicada como límite de operación",
    power: "Generador de radioisótopos (MMRTG), unos 110 W al inicio",
    purpose: "Geoquímica, atmósfera y habitabilidad de Marte",
    source: { label: "NASA, Curiosity (MSL)", url: "https://science.nasa.gov/mission/msl-curiosity/" },
    vehicle: "curiosity",
    blocked: null,
    model: {
      kind: "nasa",
      url: `${MODELS}curiosity.glb`,
      credit: NASA_MODEL_NOTE,
      page: "https://science.nasa.gov/resource/curiosity-rover-3d-model/",
    },
  },
  {
    id: "viper",
    name: "VIPER",
    type: "Rover polar lunar",
    group: "Planificado",
    status: "Construido y probado; misión prevista para 2027",
    destination: "Luna (polo sur)",
    terrains: "Regolito, suelos blandos, sombras permanentes y cráteres",
    locomotion: "4 ruedas, suspensión activa independiente",
    mass: "447 kg",
    size: "1,7 × 1,7 × 2,5 m",
    speed: "720 m/h; 400 m/h al prospectar",
    slope: "Hasta 15°",
    power: "Paneles solares y batería de 5420 Wh",
    purpose: "Buscar hielo de agua y volátiles en el suelo lunar",
    source: { label: "NASA, VIPER: Rover and Instruments", url: "https://science.nasa.gov/mission/viper/rover-and-instruments/" },
    vehicle: "viper",
    blocked: null,
    model: { kind: "simplificado", note: "NASA no publica un modelo 3D de VIPER: forma simplificada con sus medidas publicadas." },
  },
  {
    id: "cadre",
    name: "CADRE",
    type: "Sistema de 3 microrrovers",
    group: "Planificado",
    status: "Demostración tecnológica futura (NASA/JPL)",
    destination: "Luna (Reiner Gamma)",
    terrains: "Regolito lunar; levantamiento distribuido",
    locomotion: "3 rovers, cada uno con 4 ruedas",
    mass: "No publicada",
    size: "Como una maleta de mano",
    speed: "No publicada",
    slope: "No publicada",
    power: "Paneles solares",
    purpose: "Cartografía cooperativa en 3D del subsuelo",
    source: { label: "NASA JPL, CADRE", url: "https://www.jpl.nasa.gov/missions/cadre/" },
    vehicle: null,
    blocked: "No se puede simular: NASA no publica la masa de cada rover ni el tamaño de sus ruedas.",
    model: null,
  },
  {
    id: "duaxel",
    name: "DuAxel",
    type: "Rover modular con cable",
    group: "Prototipo",
    status: "Prototipo de investigación",
    destination: "Luna, Marte y asteroides (potencial)",
    terrains: "Acantilados, pendientes extremas, cuevas y cráteres",
    locomotion: "4 ruedas acopladas; 2 por cada módulo Axel",
    mass: "No publicada",
    size: "No publicado",
    speed: "No publicada",
    slope: "No publicada",
    power: "Sin cifra pública",
    purpose: "Bajar con un cable a terrenos inaccesibles",
    source: { label: "NASA JPL, DuAxel", url: "https://www.jpl.nasa.gov/robotics-at-jpl/duaxel/" },
    vehicle: null,
    blocked: "No se puede simular: no hay masa ni medidas publicadas, y baja colgado de un cable.",
    model: null,
  },
  {
    id: "eels",
    name: "EELS",
    type: "Robot articulado tipo serpiente",
    group: "Prototipo",
    status: "Prototipo en desarrollo",
    destination: "La Tierra y posibles mundos helados",
    terrains: "Hielo, nieve, arena, grietas y conductos",
    locomotion: "Segmentos con tornillos helicoidales; sin ruedas",
    mass: "100 kg (EELS 1.0)",
    size: "4,4 m de largo",
    speed: "No publicada",
    slope: "No publicada",
    power: "No publicada para la versión 1.0",
    purpose: "Explorar terrenos confinados de forma autónoma",
    source: { label: "NASA JPL, EELS", url: "https://www.jpl.nasa.gov/robotics-at-jpl/eels/" },
    vehicle: null,
    blocked: "No se puede simular: no tiene ruedas; avanza con tornillos.",
    model: null,
  },
  {
    id: "lrv",
    name: "Carro lunar del Apolo",
    type: "Vehículo tripulado (LRV)",
    group: "Histórico",
    status: "Usado en la Luna en 1971 y 1972 (Apolo 15, 16 y 17)",
    destination: "Luna",
    terrains: "Regolito, con pendientes de hasta 19 a 23°",
    locomotion: "4 ruedas de malla de acero, dirección en los dos ejes",
    mass: "708 kg con dos astronautas y carga (210 kg vacío)",
    size: "3,1 × 1,8 × 1,14 m",
    speed: "6 a 7 km/h de crucero; unos 13 km/h como máximo",
    slope: "19 a 23° registradas en el Apolo 15",
    power: "Dos baterías de plata y zinc de 36 V",
    purpose: "Llevar a los astronautas; es la única rueda medida en la Luna",
    source: { label: "NASA NSSDC, Apollo Lunar Roving Vehicle", url: "https://nssdc.gsfc.nasa.gov/planetary/lunar/apollo_lrv.html" },
    vehicle: "lrv",
    blocked: null,
    model: { kind: "simplificado", note: "Forma simplificada con las medidas publicadas. No está en el Excel del equipo: se añade como referencia." },
  },
];

export const robotById = (id: string): RobotEntry => ROBOTS.find((robot) => robot.id === id) ?? ROBOTS[0];
export const robotOfVehicle = (vehicle: VehicleId): RobotEntry => ROBOTS.find((robot) => robot.vehicle === vehicle) ?? ROBOTS[0];
