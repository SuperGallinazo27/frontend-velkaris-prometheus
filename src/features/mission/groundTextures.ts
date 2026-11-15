/**
 * Texturas de detalle del suelo y de las rocas del simulador.
 *
 * La imagen de satélite tiene un punto cada 10 m: junto al robot, el suelo sería una mancha de un
 * solo color. Estas texturas son fotografías reales de materiales (arena, grava, ceniza, lava…)
 * que añaden el grano y el relieve fino cerca de la cámara. **No son fotos del lugar**: el color
 * sigue saliendo del satélite, y la textura solo lo hace variar alrededor de su media.
 *
 * Son de Poly Haven (https://polyhaven.com), licencia CC0, reducidas a 512 px por
 * `scripts/modelos/texturas.py`, que también calcula su color medio.
 */
import { RepeatWrapping, SRGBColorSpace, TextureLoader } from "three";
import type { Texture } from "three";
import type { Surface, TerrainReading } from "../world/terrainReading";

export interface GroundTexture {
  /** Nombre del material en Poly Haven. */
  asset: string;
  /** Lado de terreno que cubre una repetición, m. */
  tileM: number;
  /** Color medio en espacio lineal: la textura se divide por él para no cambiar el color del suelo. */
  mean: readonly [number, number, number];
  author: string;
}

/** Una textura por tipo de superficie, más la de las rocas («bloque»). */
export const GROUND_TEXTURES: Record<Surface | "bloque", GroundTexture> = {
  arena: { asset: "sandy_gravel_02", tileM: 2.53, mean: [0.3232, 0.1729, 0.0855], author: "Dario Barresi" },
  grava: { asset: "rocks_ground_01", tileM: 2.0, mean: [0.2674, 0.2282, 0.1784], author: "Rob Tuytel" },
  ceniza: { asset: "rock_ground", tileM: 1.5, mean: [0.1871, 0.1592, 0.1289], author: "Rob Tuytel" },
  lava: { asset: "dark_rock", tileM: 2.42, mean: [0.0156, 0.012, 0.009], author: "Amal Kumar" },
  roca: { asset: "rock_08", tileM: 1.5, mean: [0.2759, 0.208, 0.1335], author: "Rob Tuytel" },
  suelo: { asset: "dry_ground_rocks", tileM: 4.0, mean: [0.3103, 0.1808, 0.0826], author: "Rob Tuytel" },
  sal: { asset: "dry_ground_01", tileM: 4.0, mean: [0.2373, 0.1986, 0.1465], author: "Rob Tuytel" },
  nieve: { asset: "snow_02", tileM: 2.0, mean: [0.3788, 0.3784, 0.3884], author: "Rob Tuytel" },
  vegetacion: { asset: "grass_ground", tileM: 2.51, mean: [0.1576, 0.1186, 0.0488], author: "Charlotte Baglioni" },
  bloque: { asset: "rock_boulder_dry", tileM: 1.8, mean: [0.3993, 0.3383, 0.2716], author: "Dimitrios Savva y Rico Cilliers" },
};

export const GROUND_CREDIT = "Texturas de detalle de Poly Haven (CC0)";

/** Carpeta pública de las texturas, con la base de la aplicación por delante. */
const folder = () => `${(import.meta.env?.BASE_URL as string | undefined) ?? "/"}texturas/`;

export const groundUrls = (name: Surface | "bloque") => ({ color: `${folder()}${name}-color.jpg`, normal: `${folder()}${name}-normal.jpg` });

/**
 * Qué superficie se dibuja en un lugar. Con lectura de fotos, la que vio la IA. Sin ella, la que
 * corresponde al suelo elegido para las ruedas: arena para los arenosos, nieve para la nieve y
 * suelo fino para el resto.
 */
export function surfaceFor(reading: Pick<TerrainReading, "surface" | "secondary"> | null, soilId: string): { surface: Surface; secondary: Surface | null; fromReading: boolean } {
  if (reading) return { surface: reading.surface, secondary: reading.secondary, fromReading: true };
  const surface: Surface = /nieve/.test(soilId) ? "nieve" : /arena|grc/.test(soilId) ? "arena" : "suelo";
  return { surface, secondary: null, fromReading: false };
}

export interface LoadedGround {
  color: Texture;
  normal: Texture;
  info: GroundTexture;
}

/** Carga el color y el relieve fino de una superficie. Las dos imágenes se repiten sin costura. */
export async function loadGround(name: Surface | "bloque", anisotropy = 1): Promise<LoadedGround> {
  const loader = new TextureLoader();
  const urls = groundUrls(name);
  const [color, normal] = await Promise.all([loader.loadAsync(urls.color), loader.loadAsync(urls.normal)]);
  color.colorSpace = SRGBColorSpace;
  for (const texture of [color, normal]) {
    texture.wrapS = RepeatWrapping;
    texture.wrapT = RepeatWrapping;
    texture.anisotropy = anisotropy;
  }
  return { color, normal, info: GROUND_TEXTURES[name] };
}
