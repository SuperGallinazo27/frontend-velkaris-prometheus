/**
 * Fotos de un lugar, desde Wikimedia Commons (https://commons.wikimedia.org).
 *
 * - Gratuito y sin clave. Solo se envían las coordenadas del lugar.
 * - Cada foto tiene su autor y su licencia: hay que mostrarlos junto a la imagen.
 * - Son fotos subidas por voluntarios cerca de esas coordenadas, no una selección revisada.
 */

export const ENDPOINT = "https://commons.wikimedia.org/w/api.php";

/** Radio máximo que admite la búsqueda por coordenadas, en metros. */
export const RADIUS_M = 10_000;
const MAX_PHOTOS = 8;
const CACHE_MS = 30 * 60 * 1000;

export interface Photo {
  title: string;
  /** Miniatura para la galería. */
  thumbnail: string;
  /** Página de la foto en Commons, con el original y la licencia completa. */
  page: string;
  author: string;
  license: string;
  width: number;
  height: number;
}

export function photosUrl(latitude: number, longitude: number): string {
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    origin: "*",
    generator: "geosearch",
    ggscoord: `${latitude.toFixed(4)}|${longitude.toFixed(4)}`,
    ggsradius: String(RADIUS_M),
    ggsnamespace: "6",
    ggslimit: "40",
    prop: "imageinfo",
    iiprop: "url|extmetadata|mime|size",
    iiurlwidth: "480",
    iiextmetadatafilter: "Artist|LicenseShortName",
  });
  return `${ENDPOINT}?${params}`;
}

const ENTITIES: Record<string, string> = { amp: "&", quot: '"', lt: "<", gt: ">", nbsp: " ", "#039": "'", "#39": "'" };

/** El autor llega como HTML: se queda solo el texto. */
export function plainText(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&(#?\w+);/g, (match, name: string) => ENTITIES[name] ?? match)
    .replace(/\s+/g, " ")
    .trim();
}

/** «File:Etna peak (3).jpg» → «Etna peak»: sirve de título y para no repetir series casi idénticas. */
function cleanTitle(title: string): string {
  return title
    .replace(/^File:/, "")
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[_]+/g, " ")
    .replace(/\s*[([]?\d+[)\]]?\s*$/, "")
    .trim();
}

interface RawPage {
  title?: string;
  index?: number;
  imageinfo?: {
    thumburl?: string;
    descriptionurl?: string;
    mime?: string;
    width?: number;
    height?: number;
    thumbwidth?: number;
    thumbheight?: number;
    extmetadata?: Record<string, { value?: string } | undefined>;
  }[];
}

/** Convierte la respuesta: solo fotografías con autor y licencia, sin series repetidas. */
export function parsePhotos(body: unknown): Photo[] {
  const pages = (body as { query?: { pages?: Record<string, RawPage> } })?.query?.pages;
  if (!pages) return [];
  const seen = new Set<string>();
  const photos: Photo[] = [];
  const ordered = Object.values(pages).sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  for (const page of ordered) {
    const info = page.imageinfo?.[0];
    const license = info?.extmetadata?.LicenseShortName?.value;
    const author = plainText(info?.extmetadata?.Artist?.value ?? "");
    // Los mapas y diagramas suelen ser SVG o PNG: aquí interesan las fotografías.
    if (!info?.thumburl || !info.descriptionurl || info.mime !== "image/jpeg" || !license || !author) continue;
    if ((info.width ?? 0) < 640) continue;
    const title = cleanTitle(page.title ?? "");
    const key = title.toLowerCase();
    if (!title || seen.has(key)) continue;
    seen.add(key);
    photos.push({
      title,
      thumbnail: info.thumburl,
      page: info.descriptionurl,
      author: author.length > 60 ? `${author.slice(0, 57)}…` : author,
      license,
      width: info.thumbwidth ?? info.width ?? 480,
      height: info.thumbheight ?? info.height ?? 320,
    });
    if (photos.length === MAX_PHOTOS) break;
  }
  return photos;
}

const cache = new Map<string, { at: number; value: Promise<Photo[]> }>();

export function fetchPhotos(
  latitude: number,
  longitude: number,
  fetcher: typeof fetch = fetch,
  now = Date.now(),
): Promise<Photo[]> {
  const url = photosUrl(latitude, longitude);
  const hit = cache.get(url);
  if (hit && now - hit.at < CACHE_MS) return hit.value;

  const value = fetcher(url).then(async (response) => {
    if (!response.ok) throw new Error(`Wikimedia Commons respondió ${response.status}`);
    return parsePhotos(await response.json());
  });
  cache.set(url, { at: now, value });
  // Un fallo no se guarda: el próximo intento vuelve a consultar.
  value.catch(() => {
    if (cache.get(url)?.value === value) cache.delete(url);
  });
  return value;
}
