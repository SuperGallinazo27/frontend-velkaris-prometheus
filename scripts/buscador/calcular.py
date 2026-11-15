"""Búsqueda amplia: zonas de la Tierra, fuera de la lista de lugares, con terreno parecido a cada región lunar.

Compara las dos superficies a la misma escala gruesa, unos 470 m por píxel:
  - Tierra: ETOPO 2022 a 15 segundos de arco (NOAA NCEI, doi:10.25921/fd45-gt74), en teselas de
    15° × 15° (ETOPO_2022_v1_15s_N30W045_surface.tif). Se leen de los .zip tal como se descargan,
    sin descomprimirlos en disco, o de una carpeta con --etopo-dir.
  - Luna: LDEM_64_FLOAT.IMG de LOLA (el mismo archivo de scripts/luna/calcular.py), 64 píxeles
    por grado, unos 474 m.
  - Lluvia anual: WorldClim 2.1 a 10 minutos de arco (Fick y Hijmans, 2017), para quedarse solo con
    zonas áridas, donde el suelo suele estar desnudo. Se descarga sola (7 MB) en --tmp.

Receta, la misma de scripts/terreno/descriptores.py llevada a esta escala: ventanas de 7 × 7
píxeles (unos 3,2 km) con relieve = máximo − mínimo, pendiente = media de la pendiente local y
rugosidad = RMS respecto a un plano; cada bloque de 5 × 5 ventanas (unos 16 km) se resume con la
mediana. La distancia de terreno es la de la aplicación.

Salida: src/data/candidatosGlobales.json, con las zonas más parecidas a cada región lunar, separadas
entre sí y lejos de los lugares que ya están en la lista. Los nombres salen de OpenStreetMap
(Nominatim), una consulta por zona y por segundo.

Uso:
  python scripts/buscador/calcular.py --zips RUTA/Descargas --ldem RUTA/LDEM_64_FLOAT.IMG --tmp RUTA/carpeta
Necesita numpy y rasterio (scripts/terreno/requirements.txt).
"""

import argparse
import datetime
import json
import math
import pathlib
import re
import time
import urllib.parse
import urllib.request
import warnings
import zipfile

import numpy as np
import rasterio
from rasterio.io import MemoryFile

ROOT = pathlib.Path(__file__).resolve().parents[2]
PLACES = ROOT / "src" / "features" / "world" / "places.json"
TERRAIN = ROOT / "src" / "data" / "terrenoReal.json"
OUT = ROOT / "src" / "data" / "candidatosGlobales.json"

ETOPO_NAME = re.compile(r"ETOPO_2022_v1_15s_([NS]\d{2}[EW]\d{3})_surface\.tif$")
ETOPO_URL = "https://www.ncei.noaa.gov/products/etopo-global-relief-model"
WORLDCLIM_URL = "https://geodata.ucdavis.edu/climate/worldclim/2_1/base/wc2.1_10m_prec.zip"
NOMINATIM = "https://nominatim.openstreetmap.org/reverse"

EARTH_RADIUS_M = 6_371_008.8
MOON_RADIUS_M = 1_737_400.0
LDEM_SHAPE = (11520, 23040)
LDEM_PPD = 64
#: Tamaño del píxel de ETOPO de norte a sur. La Luna se remuestrea a este mismo paso.
PIXEL_M = EARTH_RADIUS_M * math.radians(15 / 3600)
WINDOW_PX = 7
BLOCK_WINDOWS = 5
#: Ventanas con dato que necesita un bloque de 25.
MIN_WINDOWS = 20
#: Una ventana con menos relieve que esto es agua o un salar: el modelo no distingue cuál.
FLAT_M = 1.0
#: Lluvia anual máxima para considerar árida una zona.
ARID_MM = 250
#: Zonas por región, separación mínima entre ellas y distancia mínima a un lugar de la lista.
TOP = 5
SEPARATION_KM = 150
AWAY_FROM_LIST_KM = 60


def terrain_distance(a: dict, b: dict) -> float:
    """La distancia de terreno de la aplicación (src/features/ranking/ranking.ts)."""
    return (abs(a["relief"] - b["relief"]) / 1000 + abs(a["slope"] - b["slope"]) / 15 + abs(a["roughness"] - b["roughness"]) / 100) / 3


def window_stats(z: np.ndarray, dx_m: np.ndarray, dy_m: float):
    """Descriptores de todas las ventanas de una malla.

    `z` trae un píxel de margen por lado y `dx_m` el ancho del píxel en cada fila. Devuelve cuatro
    mallas (relieve, pendiente, rugosidad, altitud), con NaN donde la ventana no es tierra firme.
    """
    dz_dx = (z[1:-1, 2:] - z[1:-1, :-2]) / (2 * dx_m[1:-1, None])
    dz_dy = (z[2:, 1:-1] - z[:-2, 1:-1]) / (2 * dy_m)
    slope = np.degrees(np.arctan(np.hypot(dz_dx, dz_dy)))
    inner = z[1:-1, 1:-1]
    rows, cols = inner.shape[0] // WINDOW_PX, inner.shape[1] // WINDOW_PX
    shape = (rows, WINDOW_PX, cols, WINDOW_PX)
    crop = (slice(0, rows * WINDOW_PX), slice(0, cols * WINDOW_PX))
    w = inner[crop].reshape(shape).transpose(0, 2, 1, 3)
    s = slope[crop].reshape(shape).transpose(0, 2, 1, 3)
    low, high = w.min(axis=(2, 3)), w.max(axis=(2, 3))
    relief = high - low
    # Plano por mínimos cuadrados: en una ventana completa y regular, las tres columnas del ajuste
    # son ortogonales, así que cada coeficiente sale por separado.
    offset = np.arange(WINDOW_PX) - (WINDOW_PX - 1) / 2
    norm = WINDOW_PX * (offset**2).sum()
    mean = w.mean(axis=(2, 3), keepdims=True)
    along_x = (w * offset[None, None, None, :]).sum(axis=(2, 3), keepdims=True) / norm
    along_y = (w * offset[None, None, :, None]).sum(axis=(2, 3), keepdims=True) / norm
    residual = w - mean - along_x * offset[None, None, None, :] - along_y * offset[None, None, :, None]
    roughness = np.sqrt((residual**2).mean(axis=(2, 3)))
    elevation = mean[..., 0, 0]
    mean_slope = s.mean(axis=(2, 3))
    solid = (low > 0) & (relief >= FLAT_M)
    for grid in (relief, mean_slope, roughness, elevation):
        grid[~solid] = np.nan
    return relief, mean_slope, roughness, elevation


def block_medians(grids, min_windows: int = MIN_WINDOWS):
    """Mediana de cada descriptor en bloques de BLOCK_WINDOWS × BLOCK_WINDOWS ventanas."""
    rows, cols = grids[0].shape[0] // BLOCK_WINDOWS, grids[0].shape[1] // BLOCK_WINDOWS
    out = []
    count = None
    for grid in grids:
        b = grid[: rows * BLOCK_WINDOWS, : cols * BLOCK_WINDOWS].reshape(rows, BLOCK_WINDOWS, cols, BLOCK_WINDOWS)
        b = b.transpose(0, 2, 1, 3).reshape(rows, cols, BLOCK_WINDOWS**2)
        if count is None:
            count = np.isfinite(b).sum(axis=2)
        with warnings.catch_warnings():
            # Un bloque entero de mar no tiene mediana: queda en NaN, sin aviso.
            warnings.simplefilter("ignore", RuntimeWarning)
            out.append(np.where(count >= min_windows, np.nanmedian(b, axis=2), np.nan))
    return out


def earth_tile(src) -> dict:
    """Bloques de una tesela de ETOPO: centro y descriptores de los que son tierra firme."""
    z = src.read(1).astype(np.float32)
    t = src.transform
    lat_rows = t.f + (np.arange(src.height) + 0.5) * t.e
    dy = EARTH_RADIUS_M * math.radians(abs(t.e))
    dx = EARTH_RADIUS_M * math.radians(t.a) * np.cos(np.radians(lat_rows))
    relief, slope, roughness, elevation = block_medians(window_stats(z, dx, dy))
    step = WINDOW_PX * BLOCK_WINDOWS
    rows, cols = relief.shape
    lat = t.f + (1 + (np.arange(rows) + 0.5) * step) * t.e
    lon = t.c + (1 + (np.arange(cols) + 0.5) * step) * t.a
    keep = np.isfinite(relief)
    r, c = np.nonzero(keep)
    return {
        "lat": lat[r], "lon": lon[c], "relief": relief[keep], "slope": slope[keep],
        "roughness": roughness[keep], "elevation": elevation[keep],
    }


def moon_patch(ldem: np.memmap, lat0: float, lon0: float) -> np.ndarray:
    """Malla métrica de la Luna, al paso de ETOPO, centrada en una región.

    Cerca de los polos la malla se arma en un plano centrado en el polo (los meridianos convergen);
    en el resto, en un plano local. Cada punto se interpola de sus cuatro vecinos del archivo.
    """
    size = WINDOW_PX * BLOCK_WINDOWS + 2
    offsets = (np.arange(size) - (size - 1) / 2) * PIXEL_M
    east, north = np.meshgrid(offsets, -offsets)
    if abs(lat0) > 60:
        sign = 1 if lat0 > 0 else -1
        r0 = MOON_RADIUS_M * math.radians(90 - abs(lat0))
        x = r0 * math.sin(math.radians(lon0)) + east
        y = -sign * r0 * math.cos(math.radians(lon0)) + north
        lat = sign * (90 - np.degrees(np.hypot(x, y) / MOON_RADIUS_M))
        lon = np.degrees(np.arctan2(x, -sign * y))
    else:
        lat = lat0 + np.degrees(north / MOON_RADIUS_M)
        lon = lon0 + np.degrees(east / (MOON_RADIUS_M * np.cos(np.radians(lat))))
    row = (90 - lat) * LDEM_PPD - 0.5
    col = (lon % 360) * LDEM_PPD - 0.5
    r0i = np.clip(np.floor(row).astype(int), 0, LDEM_SHAPE[0] - 2)
    c0i = np.floor(col).astype(int)
    fr, fc = row - r0i, col - c0i
    c0w, c1w = c0i % LDEM_SHAPE[1], (c0i + 1) % LDEM_SHAPE[1]
    top = ldem[r0i, c0w] * (1 - fc) + ldem[r0i, c1w] * fc
    bottom = ldem[r0i + 1, c0w] * (1 - fc) + ldem[r0i + 1, c1w] * fc
    return ((top * (1 - fr) + bottom * fr) * 1000).astype(np.float32)


def moon_descriptors(ldem: np.memmap, region: dict) -> dict:
    z = moon_patch(ldem, region["latitude"], region["longitude"])
    relief, slope, roughness, _ = window_stats(z + 20_000, np.full(z.shape[0], PIXEL_M), PIXEL_M)
    values = [float(np.nanmedian(grid)) for grid in (relief, slope, roughness)]
    return {"relief": round(values[0]), "slope": round(values[1], 1), "roughness": round(values[2], 1)}


def annual_rain(tmp: pathlib.Path):
    """Lluvia anual de WorldClim (mm) y una función que la lee en un punto."""
    archive = tmp / "wc2.1_10m_prec.zip"
    if not archive.exists():
        request = urllib.request.Request(WORLDCLIM_URL, headers={"User-Agent": "prometheus-buscador/1.0"})
        for attempt in range(4):
            # El servidor de WorldClim a veces no contesta al primer intento.
            try:
                with urllib.request.urlopen(request, timeout=180) as response:
                    archive.write_bytes(response.read())
                break
            except OSError:
                if attempt == 3:
                    raise SystemExit(f"No se pudo descargar {WORLDCLIM_URL}. Descárgalo a mano y guárdalo en {archive}.") from None
                time.sleep(10)
    total = None
    with zipfile.ZipFile(archive) as z:
        for name in sorted(n for n in z.namelist() if n.endswith(".tif")):
            with MemoryFile(z.read(name)) as memory, memory.open() as src:
                month = src.read(1).astype(np.float64)
                month[(month < 0) | (month > 20_000)] = np.nan
                total = month if total is None else total + month
                transform = src.transform

    def at(lat: np.ndarray, lon: np.ndarray) -> np.ndarray:
        row = np.clip(((lat - transform.f) / transform.e).astype(int), 0, total.shape[0] - 1)
        col = np.clip(((lon - transform.c) / transform.a).astype(int), 0, total.shape[1] - 1)
        return total[row, col]

    return at


def haversine_km(lat1, lon1, lat2, lon2):
    p1, p2 = np.radians(lat1), np.radians(lat2)
    h = np.sin((p2 - p1) / 2) ** 2 + np.cos(p1) * np.cos(p2) * np.sin(np.radians(lon2 - lon1) / 2) ** 2
    return 2 * EARTH_RADIUS_M / 1000 * np.arcsin(np.sqrt(np.clip(h, 0, 1)))


def latin(text: str | None) -> bool:
    """true si el nombre está en alfabeto latino."""
    return bool(text) and all(ord(char) < 0x250 for char in text if char.isalpha())


def place_name(lat: float, lon: float, cache: dict, cache_path: pathlib.Path) -> dict:
    """Región y país de un punto, de OpenStreetMap. Una consulta por segundo, guardada para no repetirla."""
    key = f"{lat:.3f},{lon:.3f}"
    if key not in cache:
        query = urllib.parse.urlencode({"format": "jsonv2", "lat": f"{lat:.4f}", "lon": f"{lon:.4f}", "zoom": 8, "accept-language": "es,en"})
        request = urllib.request.Request(f"{NOMINATIM}?{query}", headers={"User-Agent": "prometheus-buscador/1.0"})
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                address = json.load(response).get("address", {})
        except Exception:
            address = {}
        # La división más amplia suele tener nombre en español o en inglés; las comarcas, a veces solo
        # en la escritura local, que aquí no se podría leer.
        area = next((address[k] for k in ("state", "region", "province", "state_district", "county") if latin(address.get(k))), None)
        cache[key] = {"area": area, "country": address.get("country")}
        cache_path.write_text(json.dumps(cache, ensure_ascii=False), encoding="utf-8")
        time.sleep(1.1)
    return cache[key]


def tile_sources(args) -> dict[str, tuple[pathlib.Path, str | None]]:
    found: dict[str, tuple[pathlib.Path, str | None]] = {}
    if args.etopo_dir:
        for path in sorted(pathlib.Path(args.etopo_dir).rglob("*.tif")):
            match = ETOPO_NAME.search(path.name)
            if match:
                found.setdefault(match[1], (path, None))
    if args.zips:
        for path in sorted(pathlib.Path(args.zips).glob("TOPOGRAFIA LUNA TIERRA*.zip")):
            with zipfile.ZipFile(path) as archive:
                for member in archive.namelist():
                    match = ETOPO_NAME.search(member)
                    if match:
                        found.setdefault(match[1], (path, member))
    return found


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--zips", help="carpeta con los .zip de Google Drive que traen las teselas de ETOPO")
    parser.add_argument("--etopo-dir", help="carpeta con las teselas de ETOPO ya descomprimidas")
    parser.add_argument("--ldem", required=True, help="LDEM_64_FLOAT.IMG")
    parser.add_argument("--tmp", required=True, help="carpeta para la lluvia de WorldClim y los nombres ya consultados")
    args = parser.parse_args()
    tmp = pathlib.Path(args.tmp)
    tmp.mkdir(parents=True, exist_ok=True)

    sources = tile_sources(args)
    if not sources:
        raise SystemExit("No se encontró ninguna tesela de ETOPO: indica --zips o --etopo-dir")

    # Los bloques de la Tierra se guardan en --tmp: si falla un paso posterior (la lluvia o los
    # nombres se piden por internet), al repetir no hay que recorrer las teselas otra vez.
    saved = tmp / "bloques.npz"
    parts = []
    bounds = [90.0, -90.0]
    if saved.exists():
        with np.load(saved) as stored:
            if int(stored["tiles"]) == len(sources):
                parts = [{key: stored[key] for key in ("lat", "lon", "relief", "slope", "roughness", "elevation")}]
                bounds = [float(stored["bounds"][0]), float(stored["bounds"][1])]
                print(f"Bloques ya calculados en {saved.name}", flush=True)
    for index, (tile, (path, member)) in enumerate(sorted(sources.items()) if not parts else [], 1):
        if member:
            with zipfile.ZipFile(path) as archive:
                data = archive.read(member)
            with MemoryFile(data) as memory, memory.open() as src:
                part = earth_tile(src)
                bounds = [min(bounds[0], src.bounds.bottom), max(bounds[1], src.bounds.top)]
        else:
            with rasterio.open(path) as src:
                part = earth_tile(src)
                bounds = [min(bounds[0], src.bounds.bottom), max(bounds[1], src.bounds.top)]
        parts.append(part)
        print(f"{index}/{len(sources)} {tile}: {part['lat'].size} bloques de tierra", flush=True)

    blocks = {key: np.concatenate([p[key] for p in parts]) for key in parts[0]}
    total = blocks["lat"].size
    np.savez(saved, tiles=len(sources), bounds=np.array(bounds), **blocks)
    rain = annual_rain(tmp)(blocks["lat"], blocks["lon"])
    arid = np.isfinite(rain) & (rain < ARID_MM)
    places = json.loads(PLACES.read_text(encoding="utf-8"))
    far = np.ones(total, dtype=bool)
    for place in places:
        far &= haversine_km(place["latitude"], place["longitude"], blocks["lat"], blocks["lon"]) >= AWAY_FROM_LIST_KM
    usable = np.nonzero(arid & far)[0]
    print(f"{total} bloques de tierra; {int(arid.sum())} áridos; {usable.size} áridos y lejos de la lista", flush=True)

    ldem = np.memmap(args.ldem, dtype="<f4", mode="r", shape=LDEM_SHAPE)
    regions = json.loads(TERRAIN.read_text(encoding="utf-8"))["regions"]
    cache_path = tmp / "nombres.json"
    cache = json.loads(cache_path.read_text(encoding="utf-8")) if cache_path.exists() else {}
    result = {}
    for region in regions:
        target = moon_descriptors(ldem, region)
        distance = (np.abs(blocks["relief"][usable] - target["relief"]) / 1000
                    + np.abs(blocks["slope"][usable] - target["slope"]) / 15
                    + np.abs(blocks["roughness"][usable] - target["roughness"]) / 100) / 3
        chosen: list[int] = []
        for position in np.argsort(distance):
            i = usable[position]
            if all(haversine_km(blocks["lat"][i], blocks["lon"][i], blocks["lat"][j], blocks["lon"][j]) >= SEPARATION_KM for j in chosen):
                chosen.append(i)
                if len(chosen) == TOP:
                    break
        candidates = []
        for i in chosen:
            lat, lon = float(blocks["lat"][i]), float(blocks["lon"][i])
            here = {"relief": float(blocks["relief"][i]), "slope": float(blocks["slope"][i]), "roughness": float(blocks["roughness"][i])}
            candidates.append({
                "latitude": round(lat, 3), "longitude": round(lon, 3), **place_name(lat, lon, cache, cache_path),
                "relief": round(here["relief"]), "slope": round(here["slope"], 1), "roughness": round(here["roughness"], 1),
                "elevation": round(float(blocks["elevation"][i])), "rainMm": round(float(rain[i])),
                "distance": round(terrain_distance(here, target), 4),
            })
        result[region["id"]] = {"coarse": target, "candidates": candidates}
        print(f"{region['name']} {target}: " + "; ".join(f"{c['area']}, {c['country']} ({c['distance']})" for c in candidates), flush=True)

    OUT.write_text(
        json.dumps(
            {
                "generatedAt": datetime.date.today().isoformat(),
                "sources": {
                    "earth": {"name": "ETOPO 2022, 15 segundos de arco (NOAA NCEI)", "url": ETOPO_URL, "doi": "10.25921/fd45-gt74"},
                    "moon": {"name": "LRO LOLA, LDEM_64 (PDS)", "url": "https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/cylindrical/float_img/"},
                    "rain": {"name": "WorldClim 2.1, 10 minutos de arco (Fick y Hijmans, 2017)", "url": "https://www.worldclim.org/data/worldclim21.html"},
                    "names": {"name": "© colaboradores de OpenStreetMap (Nominatim)", "url": "https://www.openstreetmap.org/copyright"},
                },
                "method": f"Tierra y Luna a unos {round(PIXEL_M)} m por píxel. Ventanas de {WINDOW_PX} × {WINDOW_PX} píxeles; cada bloque de "
                f"{BLOCK_WINDOWS} × {BLOCK_WINDOWS} ventanas (unos {round(PIXEL_M * WINDOW_PX * BLOCK_WINDOWS / 1000)} km) se resume con la mediana. "
                "Misma distancia de terreno que la aplicación.",
                "coverage": {"latMin": round(bounds[0]), "latMax": round(bounds[1]), "tiles": len(sources), "blocks": int(total), "arid": int(arid.sum())},
                "limits": {"aridMm": ARID_MM, "separationKm": SEPARATION_KM, "awayFromListKm": AWAY_FROM_LIST_KM, "top": TOP},
                "regions": result,
            },
            ensure_ascii=False,
            indent=1,
        )
        + "\n",
        encoding="utf-8",
    )
    print(f"Escrito {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
