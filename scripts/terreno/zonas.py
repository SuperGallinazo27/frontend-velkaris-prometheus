"""Polo norte y zona central de la Luna: lectura de los archivos PDS y perfil de cada región.

Los archivos de elevación del PDS no están comprimidos: cada fila ocupa siempre los mismos bytes.
Así, un recuadro se lee pidiendo solo el tramo de bytes de sus filas, en una única consulta HTTP.

- Polo norte: LOLA GDR `ldem_75n_30m` (30 m por píxel, estereográfica polar), igual que el polo sur.
- Zona central: SLDEM2015 (LOLA + cámara de Kaguya), 512 píxeles por grado, unos 59 m en el ecuador.
  Se remuestrea a una malla métrica local de 60 m, y la Tierra se compara a esa misma resolución.
"""

import math
import urllib.request

import numpy as np
from PIL import Image
from rasterio.crs import CRS
from rasterio.transform import Affine, from_origin
from rasterio.warp import Resampling, reproject

from descriptores import hillshade, profile, tile_windows

PDS = "https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/"
MOON_RADIUS_M = 1_737_400.0
#: Metros por grado sobre la esfera lunar.
M_PER_DEGREE = MOON_RADIUS_M * math.pi / 180

PIXEL_M = 30.0
COARSE_PIXEL_M = 60.0
WINDOW_M = 3000.0

NORTH_DEM = {"path": "lola_gdr/polar/img/ldem_75n_30m.img", "size": 30496, "pixel": 30.0, "half": 457_440.0}
NORTH_OVERVIEW = {"path": "lola_gdr/polar/img/ldem_75n_240m.img", "size": 3812, "pixel": 240.0, "half": 457_440.0}
GLOBAL_OVERVIEW = {"path": "lola_gdr/cylindrical/img/ldem_16.img", "width": 5760, "height": 2880, "per_degree": 16}
SLDEM = {"dir": "sldem2015/tiles/float_img/", "per_degree": 512, "width": 23040, "height": 15360}

#: Recortes de los mapas del selector.
NORTH_MAP_EXTENT = {"xMin": -232_000, "xMax": 232_000, "yMin": -168_000, "yMax": 155_000}
CENTRAL_MAP_EXTENT = {"xMin": -75.0, "xMax": 45.0, "yMin": -12.0, "yMax": 58.0}
MAP_WIDTH_PX = 776


def fetch_bytes(url: str, start: int | None = None, end: int | None = None) -> bytes:
    """Descarga un archivo o un tramo de bytes (ambos extremos incluidos), con reintentos."""
    request = urllib.request.Request(url)
    if start is not None:
        request.add_header("Range", f"bytes={start}-{end}")
    for attempt in range(4):
        try:
            with urllib.request.urlopen(request, timeout=300) as response:
                data = response.read()
            if start is not None and len(data) != end - start + 1:
                raise OSError(f"tramo incompleto: {len(data)} bytes")
            return data
        except OSError:
            if attempt == 3:
                raise
    raise RuntimeError("sin respuesta")


def read_rows(path: str, row0: int, rows: int, width: int, dtype: str) -> np.ndarray:
    """Filas completas de una imagen PDS sin comprimir."""
    record = width * np.dtype(dtype).itemsize
    data = fetch_bytes(PDS + path, row0 * record, (row0 + rows) * record - 1)
    return np.frombuffer(data, dtype=dtype).reshape(rows, width)


def lola_heights(raw: np.ndarray) -> np.ndarray:
    """Enteros de LOLA → metros respecto a la esfera de 1737,4 km. El valor −32768 es «sin dato»."""
    heights = raw.astype(np.float64) * 0.5
    heights[raw == -32768] = np.nan
    return heights


# ---------------------------------------------------------------- Polo norte


def north_xy(latitude: float, longitude: float) -> tuple[float, float]:
    """Estereográfica del polo norte (escala verdadera en el polo): la longitud 0 queda hacia abajo."""
    r = 2 * MOON_RADIUS_M * math.tan(math.radians(90 - latitude) / 2)
    return r * math.sin(math.radians(longitude)), -r * math.cos(math.radians(longitude))


def stereo_scale(latitude: float) -> float:
    return 2 / (1 + math.sin(math.radians(abs(latitude))))


def north_region(region: dict, cache, min_valid: float, min_windows: int) -> dict:
    half = region["sizeKm"] * 500
    cx, cy = north_xy(region["latitude"], region["longitude"])
    side = int((2 * half) // WINDOW_M)
    pixels = side * int(WINDOW_M / PIXEL_M) + 2
    # Ventanas centradas en el accidente y alineadas a la malla de 30 m, con 1 píxel de margen.
    left = round((cx - side * WINDOW_M / 2) / PIXEL_M) * PIXEL_M - PIXEL_M
    top = round((cy + side * WINDOW_M / 2) / PIXEL_M) * PIXEL_M + PIXEL_M
    col0 = round((left + NORTH_DEM["half"]) / PIXEL_M)
    row0 = round((NORTH_DEM["half"] - top) / PIXEL_M)

    def load():
        block = read_rows(NORTH_DEM["path"], row0, pixels, NORTH_DEM["size"], "<i2")
        return lola_heights(block[:, col0 : col0 + pixels])

    elevation = cache(f"luna-norte-{region['id']}", load)
    pixel_true = PIXEL_M / stereo_scale(region["latitude"])
    windows, total = tile_windows(elevation, pixel_true, int(WINDOW_M / PIXEL_M), min_valid=min_valid)
    return {
        "id": region["id"],
        "name": region["name"],
        "zone": "norte",
        "resolutionM": 30,
        "latitude": region["latitude"],
        "longitude": signed(region["longitude"]),
        "box": {"xMin": round(cx - half), "xMax": round(cx + half), "yMin": round(cy - half), "yMax": round(cy + half)},
        "sizeKm": [region["sizeKm"], region["sizeKm"]],
        "windows": len(windows),
        "windowsTotal": total,
        **profile(windows, min_windows),
        "measured": None,
        "slopeCheck": None,
    }


# ---------------------------------------------------------------- Zona central


def signed(longitude: float) -> float:
    """Longitud de −180 a 180."""
    return round(((longitude + 180) % 360) - 180, 3)


def sldem_tile(latitude: float, longitude: float) -> tuple[str, int, int]:
    """Tesela de SLDEM2015 que contiene el punto: nombre, latitud norte y longitud oeste de la tesela."""
    south = math.floor(latitude / 30) * 30
    west = math.floor((longitude % 360) / 45) * 45
    if not -60 <= south <= 30:
        raise ValueError("SLDEM2015 solo cubre de 60° S a 60° N")

    def band(value: int) -> str:
        return f"{abs(value):02d}{'n' if value >= 0 else 's'}"

    name = f"sldem2015_512_{band(south)}_{band(south + 30)}_{west:03d}_{west + 45:03d}_float.img"
    return name, south + 30, west


def central_region(region: dict, cache, min_valid: float, min_windows: int) -> dict:
    latitude, longitude = region["latitude"], region["longitude"] % 360
    half = region["sizeKm"] * 500
    side = int((2 * half) // WINDOW_M)
    window_px = int(WINDOW_M / COARSE_PIXEL_M)
    pixels = side * window_px + 2
    name, tile_north, tile_west = sldem_tile(latitude, longitude)
    per_degree = SLDEM["per_degree"]

    # Bloque de la tesela que cubre el recuadro, con margen para el remuestreo.
    reach = half + 2000
    d_lat = reach / M_PER_DEGREE
    d_lon = d_lat / math.cos(math.radians(latitude))
    row0 = math.floor((tile_north - (latitude + d_lat)) * per_degree)
    row1 = math.ceil((tile_north - (latitude - d_lat)) * per_degree)
    col0 = math.floor((longitude - d_lon - tile_west) * per_degree)
    col1 = math.ceil((longitude + d_lon - tile_west) * per_degree)
    if row0 < 0 or col0 < 0 or row1 > SLDEM["height"] or col1 > SLDEM["width"]:
        raise ValueError(f"{region['id']}: el recuadro se sale de la tesela {name}")

    def load():
        block = read_rows(SLDEM["dir"] + name, row0, row1 - row0, SLDEM["width"], "<f4")[:, col0:col1]
        # Kilómetros respecto a la esfera de 1737,4 km → metros. Los valores enormes negativos son «sin dato».
        heights = block.astype(np.float64) * 1000
        heights[block < -1e30] = np.nan
        source = Affine(1 / per_degree, 0, tile_west + col0 / per_degree, 0, -1 / per_degree, tile_north - row0 / per_degree)
        moon = f"+R={MOON_RADIUS_M} +no_defs"
        local = np.full((pixels, pixels), np.nan, dtype=np.float64)
        grid_half = pixels * COARSE_PIXEL_M / 2
        reproject(
            heights,
            local,
            src_transform=source,
            src_crs=CRS.from_proj4(f"+proj=longlat {moon}"),
            src_nodata=np.nan,
            dst_transform=from_origin(-grid_half, grid_half, COARSE_PIXEL_M, COARSE_PIXEL_M),
            dst_crs=CRS.from_proj4(f"+proj=laea +lat_0={latitude} +lon_0={longitude} +units=m {moon}"),
            dst_nodata=np.nan,
            resampling=Resampling.bilinear,
        )
        return local

    elevation = cache(f"luna-central-{region['id']}", load)
    windows, total = tile_windows(elevation, COARSE_PIXEL_M, window_px, min_valid=min_valid)
    lat_half = half / M_PER_DEGREE
    lon_half = lat_half / math.cos(math.radians(latitude))
    center = signed(longitude)
    return {
        "id": region["id"],
        "name": region["name"],
        "zone": "central",
        "resolutionM": 60,
        "latitude": latitude,
        "longitude": center,
        # El mapa de esta zona va en grados: x es la longitud; y, la latitud.
        "box": {
            "xMin": round(center - lon_half, 3),
            "xMax": round(center + lon_half, 3),
            "yMin": round(latitude - lat_half, 3),
            "yMax": round(latitude + lat_half, 3),
        },
        "sizeKm": [region["sizeKm"], region["sizeKm"]],
        "windows": len(windows),
        "windowsTotal": total,
        **profile(windows, min_windows),
        "measured": None,
        "slopeCheck": None,
    }


# ---------------------------------------------------------------- Mapas del selector


def render_map(elevation: np.ndarray, pixel_m: float, path, width: int, height: int, relief: float = 1.8) -> None:
    """Relieve sombreado con un poco de la altura mezclada, para separar mesetas de fondos de cráter."""
    # Relieve exagerado y sol bajo: a esta escala, la sombra sin exagerar queda plana.
    shade = hillshade(elevation * relief, pixel_m, altitude=32.0)
    low, high = np.nanpercentile(elevation, [2, 98])
    level = np.clip((elevation - low) / (high - low), 0, 1)
    grey = np.clip(1.45 * (0.8 * shade + 0.28 * level) - 0.33, 0, 1)
    grey = np.nan_to_num(grey, nan=0.0)
    image = Image.fromarray((grey * 255).astype(np.uint8), "L").resize((width, height), Image.LANCZOS)
    image.save(path, "WEBP", quality=80, method=6)


def north_map(cache, path) -> dict:
    extent = NORTH_MAP_EXTENT
    info = NORTH_OVERVIEW

    def load():
        raw = np.frombuffer(fetch_bytes(PDS + info["path"]), dtype="<i2").reshape(info["size"], info["size"])
        return lola_heights(raw)

    full = cache("luna-norte-mapa", load)
    pixel = info["pixel"]
    col0 = round((extent["xMin"] + info["half"]) / pixel)
    col1 = round((extent["xMax"] + info["half"]) / pixel)
    row0 = round((info["half"] - extent["yMax"]) / pixel)
    row1 = round((info["half"] - extent["yMin"]) / pixel)
    height = round(MAP_WIDTH_PX * (extent["yMax"] - extent["yMin"]) / (extent["xMax"] - extent["xMin"]))
    render_map(full[row0:row1, col0:col1], pixel, path, MAP_WIDTH_PX, height)
    return {
        **extent,
        "width": MAP_WIDTH_PX,
        "height": height,
        "pole": {"x": 0, "y": 0},
        "scale": {"km": 50, "units": 50_000},
    }


def central_map(cache, path) -> dict:
    extent = CENTRAL_MAP_EXTENT
    info = GLOBAL_OVERVIEW

    def load():
        raw = np.frombuffer(fetch_bytes(PDS + info["path"]), dtype="<i2").reshape(info["height"], info["width"])
        return lola_heights(raw)

    world = cache("luna-global-mapa", load)
    # El archivo va de 0° a 360° de longitud: se gira para que el meridiano 0 quede en el centro.
    world = np.roll(world, info["width"] // 2, axis=1)
    per_degree = info["per_degree"]
    col0 = round((extent["xMin"] + 180) * per_degree)
    col1 = round((extent["xMax"] + 180) * per_degree)
    row0 = round((90 - extent["yMax"]) * per_degree)
    row1 = round((90 - extent["yMin"]) * per_degree)
    height = round(MAP_WIDTH_PX * (extent["yMax"] - extent["yMin"]) / (extent["xMax"] - extent["xMin"]))
    render_map(world[row0:row1, col0:col1], M_PER_DEGREE / per_degree, path, MAP_WIDTH_PX, height, relief=3.0)
    return {
        **extent,
        "width": MAP_WIDTH_PX,
        "height": height,
        "pole": None,
        # 500 km sobre el ecuador, en grados.
        "scale": {"km": 500, "units": round(500_000 / M_PER_DEGREE, 3)},
    }
