"""Lectura del terreno a partir de fotos reales de cada lugar, con una IA que mira imágenes (Gemini).

Para cada lugar de src/features/world/places.json:
  1. Busca en Wikimedia Commons las fotos con ubicación a menos de 10 km, con el mismo criterio
     que la pestaña «Fotos» de la aplicación (JPEG, con autor y licencia, sin series repetidas).
  2. Envía sus miniaturas a Gemini y le pide, foto por foto, si muestra el suelo natural del lugar
     y, en ese caso, qué lo cubre, cuántas rocas sueltas hay, de qué tamaño, cuánta vegetación y si
     se ve agua, barro o nieve. Después, un resumen del lugar solo con las fotos que sirven.
  3. Guarda src/data/lecturaTerreno.json con el resumen y con cada foto revisada como evidencia.

Es una estimación en clases amplias, no una medición. La confianza nunca pasa de lo que permiten
las fotos: «alta» pide 4 fotos útiles o más; «media», 2 o 3; con una sola es «baja».

La clave de Gemini se lee de la variable GEMINI_API_KEY o, con --env, de un archivo CLAVE=VALOR
(por ejemplo el .env del backend). Nunca se escribe en la salida ni en pantalla.

Uso:
  python scripts/fotos/leer.py --env ../velkaris-prometheus/.env            # los lugares que falten
  python scripts/fotos/leer.py --env RUTA/.env --solo paramo-del-cotopaxi   # uno, para probar
  python scripts/fotos/leer.py --env RUTA/.env --todo                       # repetir todos
Con la clave gratuita, Gemini admite 20 consultas al día en gemini-3.5-flash: si se acaban, el
script se detiene y se puede terminar con --modelo gemini-flash-lite-latest, que tiene cuota aparte.

Solo necesita Python 3 e internet. Tarda unos 20 minutos: hace pausas para no saturar a Wikimedia.
Guarda cada lugar en cuanto lo lee: si se interrumpe, al repetirlo continúa donde quedó.
"""

import argparse
import base64
import datetime
import json
import os
import pathlib
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[2]
PLACES = ROOT / "src" / "features" / "world" / "places.json"
OUT = ROOT / "src" / "data" / "lecturaTerreno.json"

COMMONS = "https://commons.wikimedia.org/w/api.php"
GEMINI = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
USER_AGENT = "prometheus-lectura-terreno/1.0 (proyecto educativo; fotos de Wikimedia Commons)"
RADIUS_M = 10_000
#: La pestaña «Fotos» muestra 8; aquí se revisan más, porque muchas no enseñan el suelo.
MAX_PHOTOS = 16
#: Ancho de la miniatura que mira la IA y que después se muestra como evidencia.
THUMB_PX = 640
PAUSE_S = 6
#: Pausa entre una miniatura y la siguiente, para no saturar a Wikimedia.
IMAGE_PAUSE_S = 1.0

SURFACES = ["lava", "ceniza", "arena", "grava", "roca", "suelo", "sal", "nieve", "vegetacion"]
ROCK_COVER = ["ninguna", "poca", "moderada", "mucha"]
ROCK_SIZE = ["guijarros", "piedras", "bloques", "grandes"]
VEGETATION = ["ninguna", "escasa", "moderada", "densa"]
CONFIDENCE = ["baja", "media", "alta"]

PROMPT = """Eres geólogo de campo y revisas fotos para una misión de prueba de robots exploradores.
Recibes {count} fotos tomadas a menos de 10 km de «{name}» ({province}, {country}). Queremos saber cómo es el suelo por el que rodaría un robot de 1,5 m de ancho: qué lo cubre y cuántas rocas sueltas hay.

Primero, foto por foto, di si SIRVE. Sirve si en alguna parte de la imagen se distingue el suelo natural del lugar lo bastante para decir de qué es, aunque el tema de la foto sea otro (un animal, un refugio, gente caminando). No sirve si el suelo no se ve o no se distingue: retratos cerrados, interiores, mapas o carteles, cielo, un lago o el mar, o vistas aéreas o tan lejanas que solo muestran la silueta del paisaje.

En cada foto que sirve, estima con prudencia:
- detalle: cerca, si el suelo se ve a pocos metros y se pueden contar las rocas; lejos, si solo se distingue el tipo de superficie (una ladera de ceniza, un campo de lava, nieve, pasto). En las fotos de lejos, rocas y tamano van en null.
- superficie: lo que más cubre el suelo. Valores: lava (lava o roca volcánica), ceniza (ceniza, lapilli o arena volcánica oscura), arena, grava (grava y piedras sueltas), roca (roca firme no volcánica), suelo (suelo fino, limo o arcilla), sal (costra de sal), nieve (nieve o hielo), vegetacion (pasto, pajonal o matorral que tapa el suelo).
- secundaria: lo segundo que más cubre, o null.
- rocas: parte del suelo cubierta por rocas sueltas de más de unos 10 cm. ninguna (menos del 2 %), poca (2 a 10 %), moderada (10 a 30 %), mucha (más del 30 %). null si no se distingue.
- tamano: tamaño típico de esas rocas. guijarros (menos de 10 cm), piedras (10 a 30 cm), bloques (30 cm a 1 m), grandes (más de 1 m). null si casi no hay rocas.
- vegetacion: ninguna, escasa, moderada o densa.
- mojado: true si se ve agua, barro o nieve sobre el suelo.
- visto: una frase llana, de menos de 20 palabras, que diga qué se ve.
En las fotos que no sirven, pon solo sirve=false y visto.

Después da el resumen del lugar usando solo las fotos que sirven, con los mismos campos (rocas y tamano salen solo de las fotos de cerca; si no hay ninguna de cerca, van en null), más:
- confianza: baja, media o alta, según cuántas fotos sirven y si coinciden entre sí.
- nota: una frase llana, de menos de 35 palabras, sobre cómo es el suelo. No cites números de foto.
Si ninguna foto sirve, devuelve resumen=null.

No inventes. Si algo no se distingue, elige la clase más baja y dilo en la nota. Las fotos pueden mostrar sitios distintos dentro de esos 10 km: describe lo más común."""


def enum(values, nullable=False):
    schema = {"type": "STRING", "enum": values}
    if nullable:
        schema["nullable"] = True
    return schema


FIELDS = {
    "superficie": enum(SURFACES),
    "secundaria": enum(SURFACES, nullable=True),
    "rocas": enum(ROCK_COVER, nullable=True),
    "tamano": enum(ROCK_SIZE, nullable=True),
    "vegetacion": enum(VEGETATION),
    "mojado": {"type": "BOOLEAN"},
}
SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "fotos": {
            "type": "ARRAY",
            "items": {
                "type": "OBJECT",
                "properties": {"numero": {"type": "INTEGER"}, "sirve": {"type": "BOOLEAN"}, "visto": {"type": "STRING"},
                               "detalle": enum(["cerca", "lejos"], nullable=True),
                               **{key: {**value, "nullable": True} for key, value in FIELDS.items()}},
                "required": ["numero", "sirve", "visto"],
            },
        },
        "resumen": {
            "type": "OBJECT",
            "nullable": True,
            "properties": {**FIELDS, "confianza": enum(CONFIDENCE), "nota": {"type": "STRING"}},
            "required": ["superficie", "vegetacion", "mojado", "confianza", "nota"],
        },
    },
    "required": ["fotos"],
}


def get(url: str, timeout: float = 60) -> bytes:
    """Descarga con calma: Wikimedia limita las consultas seguidas y responde 429 cuando son demasiadas."""
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    for attempt in range(6):
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return response.read()
        except urllib.error.HTTPError as error:
            if error.code not in (429, 500, 502, 503, 504) or attempt == 5:
                raise
            wait = error.headers.get("Retry-After", "")
            time.sleep(min(300, int(wait)) if wait.isdigit() else 30 * (attempt + 1))
        except OSError:
            if attempt == 5:
                raise
            time.sleep(10)
    raise AssertionError("inalcanzable")


def plain(html: str) -> str:
    text = re.sub(r"<[^>]*>", "", html)
    for name, char in (("&amp;", "&"), ("&quot;", '"'), ("&lt;", "<"), ("&gt;", ">"), ("&nbsp;", " "), ("&#039;", "'"), ("&#39;", "'")):
        text = text.replace(name, char)
    return re.sub(r"\s+", " ", text).strip()


def clean_title(title: str) -> str:
    title = re.sub(r"^File:", "", title)
    title = re.sub(r"\.[a-z0-9]+$", "", title, flags=re.I)
    title = title.replace("_", " ")
    return re.sub(r"\s*[(\[]?\d+[)\]]?\s*$", "", title).strip()


def commons_photos(lat: float, lon: float) -> list[dict]:
    """Las mismas fotos que muestra la aplicación (src/services/photos.ts)."""
    query = urllib.parse.urlencode({
        "action": "query", "format": "json", "generator": "geosearch",
        "ggscoord": f"{lat:.4f}|{lon:.4f}", "ggsradius": RADIUS_M, "ggsnamespace": 6, "ggslimit": 40,
        "prop": "imageinfo", "iiprop": "url|extmetadata|mime|size", "iiurlwidth": THUMB_PX,
        "iiextmetadatafilter": "Artist|LicenseShortName",
    })
    pages = json.loads(get(f"{COMMONS}?{query}")).get("query", {}).get("pages", {})
    photos, seen = [], set()
    for page in sorted(pages.values(), key=lambda p: p.get("index", 0)):
        info = (page.get("imageinfo") or [{}])[0]
        meta = info.get("extmetadata") or {}
        license_name = (meta.get("LicenseShortName") or {}).get("value")
        author = plain((meta.get("Artist") or {}).get("value", ""))
        if not info.get("thumburl") or not info.get("descriptionurl") or info.get("mime") != "image/jpeg":
            continue
        if not license_name or not author or (info.get("width") or 0) < 640:
            continue
        title = clean_title(page.get("title", ""))
        if not title or title.lower() in seen:
            continue
        seen.add(title.lower())
        photos.append({
            # Wikimedia añade a la miniatura parámetros de seguimiento que no hacen falta.
            "title": title, "page": info["descriptionurl"], "thumbnail": info["thumburl"].split("?")[0],
            "author": author if len(author) <= 60 else author[:57] + "…", "license": license_name,
        })
        if len(photos) == MAX_PHOTOS:
            break
    return photos


def ask_gemini(key: str, model: str, place: dict, photos: list[dict], images: list[bytes]) -> dict:
    parts = [{"text": PROMPT.format(count=len(photos), name=place["name"], province=place["province"], country=place["country"])}]
    for number, (photo, image) in enumerate(zip(photos, images), 1):
        parts.append({"text": f"FOTO {number}: «{photo['title']}»"})
        parts.append({"inlineData": {"mimeType": "image/jpeg", "data": base64.b64encode(image).decode("ascii")}})
    body = {
        "contents": [{"role": "user", "parts": parts}],
        "generationConfig": {"temperature": 0.2, "maxOutputTokens": 8192, "responseMimeType": "application/json",
                             "responseSchema": SCHEMA, "thinkingConfig": {"thinkingLevel": "low"}},
    }
    request = urllib.request.Request(GEMINI.format(model=model), data=json.dumps(body).encode("utf-8"),
                                     headers={"Content-Type": "application/json", "x-goog-api-key": key})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                data = json.load(response)
            text = "".join(part.get("text", "") for part in data["candidates"][0]["content"]["parts"] if not part.get("thought"))
            return json.loads(text)
        except urllib.error.HTTPError as error:
            # 429 (cuota) y 5xx (saturación) se reintentan con calma; lo demás es un fallo de la consulta.
            if error.code not in (429, 500, 502, 503, 504) or attempt == 3:
                raise SystemExit(f"Gemini respondió {error.code} para {place['name']}") from None
            time.sleep(20 * (attempt + 1))
        except (KeyError, IndexError, ValueError, OSError):
            if attempt == 3:
                raise SystemExit(f"Gemini no devolvió una lectura válida para {place['name']}") from None
            time.sleep(10)
    raise AssertionError("inalcanzable")


def pick(value, allowed, fallback=None):
    return value if value in allowed else fallback


def build(photos: list[dict], answer: dict) -> dict:
    """La respuesta de la IA, validada, con la confianza limitada por el número de fotos útiles."""
    by_number = {item.get("numero"): item for item in answer.get("fotos", []) if isinstance(item, dict)}
    read = []
    for number, photo in enumerate(photos, 1):
        item = by_number.get(number, {})
        useful = bool(item.get("sirve"))
        read.append({**photo, "useful": useful, "close": useful and item.get("detalle") == "cerca",
                     "seen": str(item.get("visto") or "Sin descripción.").strip()})
    useful = sum(photo["useful"] for photo in read)
    close = sum(photo["close"] for photo in read)
    summary = answer.get("resumen") if useful else None
    result = None
    if isinstance(summary, dict) and pick(summary.get("superficie"), SURFACES):
        # Las rocas solo se cuentan en fotos de cerca: sin ellas, no se dice nada de las rocas.
        cover = pick(summary.get("rocas"), ROCK_COVER) if close else None
        ceiling = "alta" if useful >= 4 else "media" if useful >= 2 else "baja"
        confidence = pick(summary.get("confianza"), CONFIDENCE, "baja")
        if CONFIDENCE.index(confidence) > CONFIDENCE.index(ceiling):
            confidence = ceiling
        secondary = pick(summary.get("secundaria"), SURFACES)
        result = {
            "surface": summary["superficie"],
            "secondary": secondary if secondary != summary["superficie"] else None,
            "rockCover": cover,
            "rockSize": None if cover in (None, "ninguna") else pick(summary.get("tamano"), ROCK_SIZE, "piedras"),
            "vegetation": pick(summary.get("vegetacion"), VEGETATION, "ninguna"),
            "wet": bool(summary.get("mojado")),
            "confidence": confidence,
            "usefulPhotos": useful,
            "closePhotos": close,
            "totalPhotos": len(read),
            "note": str(summary.get("nota") or "").strip(),
        }
    # Primero las fotos de cerca y después las demás que sirvieron: son la evidencia.
    read.sort(key=lambda photo: (not photo["close"], not photo["useful"]))
    return {"summary": result, "photos": read}


def read_key(env_path: str | None) -> str:
    key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not key and env_path:
        for line in pathlib.Path(env_path).read_text(encoding="utf-8").splitlines():
            if line.startswith("GEMINI_API_KEY="):
                key = line.split("=", 1)[1].strip()
    if not key:
        raise SystemExit("Falta la clave: define GEMINI_API_KEY o indica --env con un archivo que la tenga.")
    return key


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--env", help="archivo CLAVE=VALOR con GEMINI_API_KEY (por ejemplo el .env del backend)")
    parser.add_argument("--modelo", default="gemini-3.5-flash")
    parser.add_argument("--solo", help="id de un lugar, para probar")
    parser.add_argument("--todo", action="store_true", help="repite también los lugares ya leídos")
    args = parser.parse_args()
    key = read_key(args.env)

    places = json.loads(PLACES.read_text(encoding="utf-8"))
    stored = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else {}
    # Cada lugar guarda con qué modelo se leyó: la cuota gratuita de un modelo puede acabarse a
    # medias, y el resto se termina con otro.
    done = stored.get("places", {})
    for place in places:
        if args.solo and place["id"] != args.solo:
            continue
        if place["id"] in done and not args.todo and not args.solo:
            continue
        photos = commons_photos(place["latitude"], place["longitude"])
        if photos:
            images = []
            for photo in photos:
                images.append(get(photo["thumbnail"]))
                time.sleep(IMAGE_PAUSE_S)
            done[place["id"]] = {"model": args.modelo, **build(photos, ask_gemini(key, args.modelo, place, photos, images))}
        else:
            done[place["id"]] = {"model": None, "summary": None, "photos": []}
        summary = done[place["id"]]["summary"]
        print(f"{place['name']}: {len(photos)} fotos · " + (json.dumps(summary, ensure_ascii=False) if summary else "sin fotos que muestren el suelo"), flush=True)
        OUT.write_text(
            json.dumps(
                {
                    "generatedAt": datetime.date.today().isoformat(),
                    "model": " y ".join(sorted({entry.get("model") or args.modelo for entry in done.values() if entry.get("photos")})) or args.modelo,
                    "method": f"Fotos de Wikimedia Commons con ubicación a menos de {RADIUS_M // 1000} km del lugar (hasta {MAX_PHOTOS}), "
                    "revisadas una a una por un modelo de IA que mira imágenes. El resumen usa solo las fotos que muestran el suelo. "
                    "Las rocas solo se estiman en fotos que muestran el suelo de cerca. "
                    "La confianza es alta con 4 fotos útiles o más, media con 2 o 3 y baja con una.",
                    "source": {"photos": "Wikimedia Commons", "url": "https://commons.wikimedia.org/", "radiusKm": RADIUS_M // 1000},
                    "places": done,
                },
                ensure_ascii=False,
                indent=1,
            )
            + "\n",
            encoding="utf-8",
        )
        if not args.solo:
            time.sleep(PAUSE_S)
    print(f"Escrito {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    sys.exit(main())
