/**
 * Lectura del terreno a partir de fotos: lo que una IA (Gemini) ve en las fotos reales tomadas
 * cerca de cada lugar. Llena un hueco que los datos no cubren: el relieve de 30 m no ve rocas.
 *
 * - La tabla la genera `scripts/fotos/leer.py` con las mismas fotos de Wikimedia Commons que
 *   muestra la pestaña «Fotos», y se guarda en `src/data/lecturaTerreno.json`: no hay IA en vivo.
 * - Es una **estimación**, no una medición: clases amplias (poca, moderada, mucha) y una confianza
 *   que depende de cuántas fotos servían. Las fotos usadas quedan como evidencia.
 * - Con ella, el simulador pone más o menos rocas y de un tamaño u otro. La posición de cada roca
 *   sigue siendo al azar.
 */
import data from "../../data/lecturaTerreno.json";

/** Qué cubre el suelo. */
export type Surface = "lava" | "ceniza" | "arena" | "grava" | "roca" | "suelo" | "sal" | "nieve" | "vegetacion";
/** Parte del suelo cubierta por rocas sueltas de más de unos 10 cm. */
export type RockCover = "ninguna" | "poca" | "moderada" | "mucha";
/** Tamaño típico de esas rocas. */
export type RockSize = "guijarros" | "piedras" | "bloques" | "grandes";
export type Vegetation = "ninguna" | "escasa" | "moderada" | "densa";
export type Confidence = "baja" | "media" | "alta";

export const SURFACES: Record<Surface, string> = {
  lava: "lava o roca volcánica",
  ceniza: "ceniza o arena volcánica",
  arena: "arena",
  grava: "grava y piedras",
  roca: "roca firme",
  suelo: "suelo fino",
  sal: "costra de sal",
  nieve: "nieve o hielo",
  vegetacion: "vegetación baja",
};

/** Cada clase con el rango que representa, como fracción del suelo cubierto. */
export const ROCK_COVER: Record<RockCover, { name: string; range: readonly [number, number] }> = {
  ninguna: { name: "casi ninguna", range: [0, 0.02] },
  poca: { name: "pocas", range: [0.02, 0.1] },
  moderada: { name: "bastantes", range: [0.1, 0.3] },
  mucha: { name: "muchas", range: [0.3, 0.6] },
};

/** Cada clase con su rango de diámetro, en metros. */
export const ROCK_SIZE: Record<RockSize, { name: string; range: readonly [number, number] }> = {
  guijarros: { name: "guijarros de menos de 10 cm", range: [0.03, 0.1] },
  piedras: { name: "piedras de 10 a 30 cm", range: [0.1, 0.3] },
  bloques: { name: "bloques de 30 cm a 1 m", range: [0.3, 1] },
  grandes: { name: "bloques de más de 1 m", range: [1, 2.5] },
};

export const VEGETATION: Record<Vegetation, string> = {
  ninguna: "sin vegetación",
  escasa: "vegetación escasa",
  moderada: "vegetación moderada",
  densa: "vegetación densa",
};

export interface TerrainReading {
  /** Lo que más cubre el suelo y, si lo hay, lo segundo. */
  surface: Surface;
  secondary: Surface | null;
  /** null si ninguna foto muestra el suelo de cerca: de las rocas no se puede decir nada. */
  rockCover: RockCover | null;
  /** null si casi no hay rocas sueltas o no se distinguen. */
  rockSize: RockSize | null;
  vegetation: Vegetation;
  /** true si en las fotos se ve agua, barro o nieve en el suelo. */
  wet: boolean;
  confidence: Confidence;
  /** Fotos que mostraban el suelo, cuántas de ellas de cerca, y fotos revisadas. */
  usefulPhotos: number;
  closePhotos: number;
  totalPhotos: number;
  /** Una frase de la IA sobre lo que vio. */
  note: string;
}

/** Una foto revisada, con lo que la IA vio en ella. */
export interface ReadPhoto {
  title: string;
  /** Página de la foto en Commons, con el autor y la licencia completa. */
  page: string;
  thumbnail: string;
  author: string;
  license: string;
  /** true si en ella se distingue el suelo del lugar; false si es un retrato, un interior, el cielo… */
  useful: boolean;
  /** true si el suelo se ve a pocos metros y se pueden contar las rocas. */
  close: boolean;
  /** Qué se ve, en una frase. */
  seen: string;
}

interface PlaceReading {
  summary: TerrainReading | null;
  photos: ReadPhoto[];
}

const places = data.places as Record<string, PlaceReading | undefined>;

/** Lectura del terreno de un lugar; null si no había fotos que mostraran el suelo. */
export const readingOf = (placeId: string): TerrainReading | null => places[placeId]?.summary ?? null;

/** Las fotos revisadas de un lugar, primero las que sirvieron. */
export const readPhotosOf = (placeId: string): ReadPhoto[] => places[placeId]?.photos ?? [];

export const readingSource = { model: data.model, generatedAt: data.generatedAt, method: data.method };
