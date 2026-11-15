"""Calcula descriptores reales de terreno para el mundo interactivo.

Luna:   polo sur, elevación LOLA a 30 m (NASA PGDA, Barker et al. 2023);
        polo norte, LOLA GDR a 30 m (PDS); zona central, SLDEM2015 a 60 m (PDS). Ver zonas.py.
Tierra: Copernicus DEM GLO-30 (GLO-90 donde no haya 30 m), con su máscara de agua.

En ambos cuerpos se usa la misma receta: ventanas de 3 km sobre una malla métrica
y, por ventana, relieve, pendiente media y rugosidad (ver descriptores.py).
Cada región lunar y cada lugar terrestre se resume con la mediana de sus ventanas.
Los polos se comparan a 30 m y la zona central a 60 m, siempre con la Tierra a la misma resolución.

Solo se leen por internet los recuadros necesarios; no se descargan archivos completos.

Uso:  python scripts/terreno/calcular.py [--cache CARPETA] [--solo luna|tierra]
Sale: src/data/terrenoReal.json y los tres mapas lunares de src/features/world/
"""

import argparse
import datetime
import json
import math
import pathlib
import urllib.request

import numpy as np
import rasterio
from PIL import Image
from rasterio.transform import from_origin
from rasterio.warp import Resampling, reproject, transform_bounds
from rasterio.windows import from_bounds

import zonas
from descriptores import coarsen, slope_degrees, tile_windows
from descriptores import profile as window_profile

ROOT = pathlib.Path(__file__).resolve().parents[2]
HERE = pathlib.Path(__file__).resolve().parent
OUT_JSON = ROOT / "src" / "data" / "terrenoReal.json"
WORLD = ROOT / "src" / "features" / "world"
OUT_MAP = WORLD / "polo-sur-lunar.webp"
OUT_MAP_NORTH = WORLD / "polo-norte-lunar.webp"
OUT_MAP_CENTRAL = WORLD / "zona-central-lunar.webp"
PLACES = ROOT / "src" / "features" / "world" / "places.json"

PIXEL_M = 30.0
WINDOW_M = 3000.0
WINDOW_PX = int(WINDOW_M / PIXEL_M)
MIN_VALID = 0.9
#: Ventanas por lado en cada lugar terrestre: 6 × 3 km = 18 km, parecido a los recuadros de la NASA (~20 km).
EARTH_WINDOWS = 6
#: Con menos ventanas válidas que estas, el lugar queda sin datos en vez de resumirse con muy poco.
MIN_WINDOWS = 9
#: La zona central de la Luna se mide a 60 m: la Tierra se promedia de 2 × 2 píxeles para igualarla.
COARSE_FACTOR = 2

MOON_RADIUS_M = 1_737_400.0
PGDA = "https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/"
MOON_DEM = "LDEM_75S_30MPP_ADJ.TIF"
MOON_SLOPE = "LDSM_75S_30MPP_ADJ.TIF"
MOON_COUNT = "LDEC_75S_30MPP_ADJ.TIF"

COPERNICUS = {
    "GLO-30": {"bucket": "https://copernicus-dem-30m.s3.amazonaws.com/", "arcsec": 10, "resolution": 30},
    "GLO-90": {"bucket": "https://copernicus-dem-90m.s3.amazonaws.com/", "arcsec": 30, "resolution": 90},
}

#: Recorte del mapa lunar del selector, en metros de la proyección estereográfica polar.
MAP_EXTENT = {"xMin": -204_000, "xMax": 184_000, "yMin": -78_000, "yMax": 192_000}
MAP_PX_PER_KM = 2

GDAL_ENV = {
    "GDAL_DISABLE_READDIR_ON_OPEN": "EMPTY_DIR",
    "CPL_VSIL_CURL_ALLOWED_EXTENSIONS": ".tif,.TIF",
    "GDAL_HTTP_MAX_RETRY": "4",
    "GDAL_HTTP_RETRY_DELAY": "2",
    "VSI_CACHE": "TRUE",
}


def remote(url: str) -> str:
    return "/vsicurl/" + url


# ---------------------------------------------------------------- Luna


def stereo_to_latlon(x: float, y: float) -> tuple[float, float]:
    """Proyección estereográfica del polo sur (esfera, escala verdadera en el polo) → latitud, longitud."""
    colatitude = 2 * math.atan(math.hypot(x, y) / (2 * MOON_RADIUS_M))
    return -(90 - math.degrees(colatitude)), math.degrees(math.atan2(x, y))


def stereo_scale(latitude: float) -> float:
    """Cuánto estira las distancias la proyección a esa latitud (1 en el polo)."""
    return 2 / (1 + math.sin(math.radians(abs(latitude))))


def region_boxes() -> list[dict]:
    """Recuadros de la NASA: de píxeles del mapa a metros de la proyección."""
    spec = json.loads((HERE / "regiones_luna.json").read_text(encoding="utf-8"))
    pole_x, pole_y = spec["georreferencia"]["poloPx"]
    m_per_px = 1000 / spec["georreferencia"]["pxPorKm"]
    boxes = []
    for region in spec["regiones"]:
        left, top, right, bottom = region["px"]
        boxes.append(
            {
                "id": region["id"],
                "name": region["name"],
                "xMin": (left - pole_x) * m_per_px,
                "xMax": (right - pole_x) * m_per_px,
                "yMin": (pole_y - bottom) * m_per_px,
                "yMax": (pole_y - top) * m_per_px,
            }
        )
    return boxes


def snap(value: float) -> float:
    return round(value / PIXEL_M) * PIXEL_M


def read_moon(name: str, left: float, bottom: float, right: float, top: float) -> np.ndarray:
    with rasterio.open(remote(PGDA + name)) as dataset:
        window = from_bounds(left, bottom, right, top, dataset.transform).round_offsets().round_lengths()
        return dataset.read(1, window=window).astype(np.float64)


def moon_region(box: dict, cache) -> dict:
    cx = (box["xMin"] + box["xMax"]) / 2
    cy = (box["yMin"] + box["yMax"]) / 2
    cols = int((box["xMax"] - box["xMin"]) // WINDOW_M)
    rows = int((box["yMax"] - box["yMin"]) // WINDOW_M)
    # Las ventanas van centradas en el recuadro y alineadas a la malla de 30 m, con 1 píxel de margen.
    left = snap(cx - cols * WINDOW_M / 2) - PIXEL_M
    right = left + cols * WINDOW_M + 2 * PIXEL_M
    top = snap(cy + rows * WINDOW_M / 2) + PIXEL_M
    bottom = top - rows * WINDOW_M - 2 * PIXEL_M

    def load(name):
        return cache(f"luna-{box['id']}-{name}", lambda: read_moon(name, left, bottom, right, top))

    elevation = load(MOON_DEM)
    latitude, longitude = stereo_to_latlon(cx, cy)
    pixel_true = PIXEL_M / stereo_scale(latitude)
    windows, total = tile_windows(elevation, pixel_true, WINDOW_PX, min_valid=MIN_VALID)

    inner = (slice(1, -1), slice(1, -1))
    counts = load(MOON_COUNT)[inner]
    own_slope = float(np.nanmean(slope_degrees(elevation, pixel_true)[inner]))
    pgda_slope = float(np.nanmean(load(MOON_SLOPE)[inner]))
    return {
        "id": box["id"],
        "name": box["name"],
        "zone": "sur",
        "resolutionM": 30,
        "latitude": round(latitude, 3),
        "longitude": round(longitude, 3),
        "box": {key: round(box[key]) for key in ("xMin", "xMax", "yMin", "yMax")},
        "sizeKm": [round((box["xMax"] - box["xMin"]) / 1000, 1), round((box["yMax"] - box["yMin"]) / 1000, 1)],
        "windows": len(windows),
        "windowsTotal": total,
        **profile(windows),
        "measured": round(float(np.mean(counts > 0)), 3),
        "slopeCheck": {"own": round(own_slope, 2), "pgda": round(pgda_slope, 2)},
    }


def profile(windows: list[dict]) -> dict:
    return window_profile(windows, MIN_WINDOWS)


def moon_map(cache) -> dict:
    """Imagen del selector: relieve sombreado del polo sur a partir de la misma elevación."""
    extent = MAP_EXTENT
    step = 240.0  # una vista reducida del archivo: 8 píxeles de 30 m

    def load():
        with rasterio.open(remote(PGDA + MOON_DEM)) as dataset:
            window = from_bounds(extent["xMin"], extent["yMin"], extent["xMax"], extent["yMax"], dataset.transform)
            shape = (round((extent["yMax"] - extent["yMin"]) / step), round((extent["xMax"] - extent["xMin"]) / step))
            return dataset.read(1, window=window, out_shape=shape, resampling=Resampling.average).astype(np.float64)

    elevation = cache("luna-mapa", load)
    width = round((extent["xMax"] - extent["xMin"]) / 1000 * MAP_PX_PER_KM)
    height_px = round((extent["yMax"] - extent["yMin"]) / 1000 * MAP_PX_PER_KM)
    zonas.render_map(elevation, step, OUT_MAP, width, height_px)
    return {**extent, "width": width, "height": height_px, "pole": {"x": 0, "y": 0}, "scale": {"km": 50, "units": 50_000}}


# ---------------------------------------------------------------- Tierra


def tile_lists() -> dict:
    lists = {}
    for name, info in COPERNICUS.items():
        with urllib.request.urlopen(info["bucket"] + "tileList.txt", timeout=60) as response:
            lists[name] = set(response.read().decode().split())
    return lists


def tile_name(lat_floor: int, lon_floor: int, arcsec: int) -> str:
    ns = "N" if lat_floor >= 0 else "S"
    ew = "E" if lon_floor >= 0 else "W"
    return f"Copernicus_DSM_COG_{arcsec}_{ns}{abs(lat_floor):02d}_00_{ew}{abs(lon_floor):03d}_00_DEM"


def earth_grid(place: dict):
    """Malla métrica local de 30 m centrada en el lugar (acimutal equivalente de Lambert)."""
    half = EARTH_WINDOWS * WINDOW_M / 2 + PIXEL_M
    size = EARTH_WINDOWS * WINDOW_PX + 2
    crs = f"+proj=laea +lat_0={place['latitude']} +lon_0={place['longitude']} +datum=WGS84 +units=m +no_defs"
    return crs, from_origin(-half, half, PIXEL_M, PIXEL_M), size, half


def read_earth(place: dict, tiles: dict) -> dict:
    crs, transform, size, half = earth_grid(place)
    west, south, east, north = transform_bounds(crs, "EPSG:4326", -half, -half, half, half, densify_pts=21)
    if east < west:
        raise ValueError(f"{place['id']}: el recuadro cruza el antimeridiano")
    cells = [
        (lat, lon)
        for lat in range(math.floor(south), math.floor(north) + 1)
        for lon in range(math.floor(west), math.floor(east) + 1)
    ]
    # Se usa 30 m si están todos los recuadros que existen; si alguno solo existe a 90 m, todo el lugar va a 90 m.
    product = "GLO-30"
    for lat, lon in cells:
        if tile_name(lat, lon, 10) not in tiles["GLO-30"] and tile_name(lat, lon, 30) in tiles["GLO-90"]:
            product = "GLO-90"
    info = COPERNICUS[product]

    elevation = np.full((size, size), np.nan, dtype=np.float32)
    water = np.full((size, size), 255, dtype=np.uint8)
    used = []
    for lat, lon in cells:
        name = tile_name(lat, lon, info["arcsec"])
        if name not in tiles[product]:
            continue  # sin recuadro: mar abierto
        used.append(name)
        base = info["bucket"] + name + "/"
        part = np.full((size, size), np.nan, dtype=np.float32)
        with rasterio.open(remote(base + name + ".tif")) as dataset:
            reproject(
                rasterio.band(dataset, 1), part, dst_transform=transform, dst_crs=crs,
                dst_nodata=np.nan, resampling=Resampling.bilinear,
            )
        mask = np.full((size, size), 255, dtype=np.uint8)
        with rasterio.open(remote(base + "AUXFILES/" + name.replace("_DEM", "_WBM") + ".tif")) as dataset:
            reproject(
                rasterio.band(dataset, 1), mask, dst_transform=transform, dst_crs=crs,
                dst_nodata=255, resampling=Resampling.nearest,
            )
        fill = np.isnan(elevation) & np.isfinite(part)
        elevation[fill] = part[fill]
        water[fill] = mask[fill]
    return {"elevation": elevation, "water": water, "product": np.array(product), "tiles": np.array(used)}


def earth_site(place: dict, tiles: dict, cache) -> dict:
    data = cache(f"tierra-{place['id']}-{place['latitude']}-{place['longitude']}", lambda: read_earth(place, tiles))
    product = str(data["product"])
    elevation = data["elevation"].astype(np.float64)
    wet = data["water"] != 0  # 0 = tierra; 1 mar, 2 lago, 3 río; 255 = sin recuadro
    elevation[wet] = np.nan
    windows, total = tile_windows(elevation, PIXEL_M, WINDOW_PX, min_valid=MIN_VALID)
    inner = (slice(1, -1), slice(1, -1))
    # La misma área a 60 m, para comparar con la zona central de la Luna.
    coarse = coarsen(elevation[inner], COARSE_FACTOR)
    coarse_windows, coarse_total = tile_windows(
        coarse, PIXEL_M * COARSE_FACTOR, WINDOW_PX // COARSE_FACTOR, margin_px=0, min_valid=MIN_VALID
    )
    return {
        "id": place["id"],
        "latitude": place["latitude"],
        "longitude": place["longitude"],
        "dem": product,
        "resolutionM": COPERNICUS[product]["resolution"],
        "tiles": [str(t) for t in data["tiles"]],
        "windows": len(windows),
        "windowsTotal": total,
        "water": round(float(np.mean(wet[inner])), 3),
        **profile(windows),
        "coarse": {
            "resolutionM": int(PIXEL_M * COARSE_FACTOR),
            "windows": len(coarse_windows),
            "windowsTotal": coarse_total,
            **profile(coarse_windows),
        },
    }


# ---------------------------------------------------------------- Programa


def report(region: dict) -> None:
    """Una línea por región, para seguir el cálculo."""
    extra = ""
    if region["measured"] is not None:
        check = region["slopeCheck"]
        extra = f"  medido {region['measured']:.0%}  pendiente propia/PGDA {check['own']}/{check['pgda']}"
    print(f"luna {region['zone']:<8} {region['name']:<24} {region['resolutionM']} m  {region['windows']:>3} ventanas  "
          f"relieve {region['relief']['median']:>5.0f} m  pendiente {region['slope']['median']:>4.1f}°  "
          f"rugosidad {region['roughness']['median']:>5.1f} m{extra}")


def make_cache(folder):
    """Guarda en disco lo leído por internet para no repetirlo al ajustar el cálculo."""
    if not folder:
        return lambda key, load: load()
    folder = pathlib.Path(folder)
    folder.mkdir(parents=True, exist_ok=True)

    def cached(key, load):
        path = folder / (key.replace("/", "_") + ".npz")
        if path.exists():
            stored = np.load(path)
            return stored["value"] if stored.files == ["value"] else {name: stored[name] for name in stored.files}
        value = load()
        if isinstance(value, dict):
            np.savez_compressed(path, **value)
        else:
            np.savez_compressed(path, value=value)
        return value

    return cached


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--cache", help="carpeta para guardar lo leído por internet")
    parser.add_argument("--solo", choices=["luna", "tierra"], help="recalcular solo una parte")
    args = parser.parse_args()
    cache = make_cache(args.cache)
    previous = json.loads(OUT_JSON.read_text(encoding="utf-8")) if OUT_JSON.exists() else {}

    with rasterio.Env(**GDAL_ENV):
        if args.solo != "tierra":
            regions = []
            for box in region_boxes():
                region = moon_region(box, cache)
                regions.append(region)
                report(region)
            definitions = json.loads((HERE / "regiones_luna.json").read_text(encoding="utf-8"))["zonas"]
            for definition in definitions["norte"]:
                regions.append(zonas.north_region(definition, cache, MIN_VALID, MIN_WINDOWS))
                report(regions[-1])
            for definition in definitions["central"]:
                regions.append(zonas.central_region(definition, cache, MIN_VALID, MIN_WINDOWS))
                report(regions[-1])
            maps = {
                "sur": moon_map(cache),
                "norte": zonas.north_map(cache, OUT_MAP_NORTH),
                "central": zonas.central_map(cache, OUT_MAP_CENTRAL),
            }
        else:
            regions, maps = previous.get("regions", []), previous.get("maps")

        if args.solo != "luna":
            tiles = tile_lists()
            sites = []
            for place in json.loads(PLACES.read_text(encoding="utf-8")):
                site = earth_site(place, tiles, cache)
                sites.append(site)
                if site["relief"]:
                    coarse = site["coarse"]
                    print(f"tierra {place['name']:<26} {site['dem']} {site['windows']:>2}/{site['windowsTotal']}  "
                          f"relieve {site['relief']['median']:>5.0f} m  pendiente {site['slope']['median']:>4.1f}°  "
                          f"rugosidad {site['roughness']['median']:>5.1f} m  agua {site['water']:.0%}  | a 60 m: "
                          f"{coarse['relief']['median']:.0f} m, {coarse['slope']['median']}°, {coarse['roughness']['median']} m")
                else:
                    print(f"tierra {place['name']:<26} {site['dem']} {site['windows']:>2}/{site['windowsTotal']}  SIN DATOS")
        else:
            sites = previous.get("sites", [])

    result = {
        "generatedAt": datetime.date.today().isoformat(),
        "method": {
            "definition": "prometheus_topography_plane_v1",
            "windowM": WINDOW_M,
            "pixelM": PIXEL_M,
            "minValid": MIN_VALID,
            "minWindows": MIN_WINDOWS,
            "earthWindowsPerSide": EARTH_WINDOWS,
            "statistic": "median",
        },
        "sources": {
            "moon": {
                "name": "LOLA South Pole DEM, 30 m/px (NASA GSFC PGDA)",
                "product": MOON_DEM,
                "url": "https://pgda.gsfc.nasa.gov/products/90",
                "citation": "Barker et al. (2023), Planetary Science Journal 4, 183. doi:10.3847/PSJ/acf3e1",
            },
            "moonNorth": {
                "name": "LOLA Gridded Data Record, polo norte, 30 m/px (NASA PDS Geosciences)",
                "product": zonas.NORTH_DEM["path"],
                "url": "https://pds-geosciences.wustl.edu/missions/lro/lola.htm",
                "citation": "Smith et al. (2010), LRO LOLA Gridded Data Record, NASA Planetary Data System.",
            },
            "moonCentral": {
                "name": "SLDEM2015, LOLA + cámara de Kaguya, 512 píxeles por grado (NASA PDS Geosciences)",
                "product": zonas.SLDEM["dir"],
                "url": "https://pds-geosciences.wustl.edu/missions/lro/lola.htm",
                "citation": "Barker et al. (2016), Icarus 273, 346-355. doi:10.1016/j.icarus.2015.07.039",
            },
            "names": {
                "name": "Gazetteer of Planetary Nomenclature (IAU / USGS)",
                "url": "https://planetarynames.wr.usgs.gov/",
            },
            "earth": {
                "name": "Copernicus DEM GLO-30 / GLO-90",
                "url": "https://registry.opendata.aws/copernicus-dem/",
                "citation": "© DLR e.V. 2010-2014 y © Airbus Defence and Space GmbH 2014-2018, "
                            "provisto bajo COPERNICUS por la Unión Europea y la ESA; todos los derechos reservados.",
            },
            "regions": {
                "name": "Regiones candidatas de Artemis III (NASA, 28 de octubre de 2024)",
                "url": "https://www.nasa.gov/news-release/nasa-provides-update-on-artemis-iii-moon-landing-regions/",
                "note": "Ubicación aproximada, medida sobre el mapa publicado; la NASA no publicó coordenadas.",
            },
        },
        "maps": maps,
        "regions": regions,
        "sites": sites,
    }
    OUT_JSON.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(f"\nEscrito {OUT_JSON.relative_to(ROOT)} y los mapas lunares de {WORLD.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
