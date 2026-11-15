"""Relieve y rugosidad de la Luna medidos por el láser LOLA (LRO, NASA), para la aplicación.

Entradas: el conjunto LRO-L-LOLA-4-GDR-V1.0 del PDS Geosciences Node, en proyección cilíndrica
y valores en coma flotante:
https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/cylindrical/float_img/
  - ldem_64_float.img: elevación, 64 píxeles por grado (unos 474 m en el ecuador), en km sobre
    la esfera de 1737,4 km. 1 GB.
  - ldrm_32_50_float.img: rugosidad, la mediana (cuantil 0,50) de cada píxel, 32 píxeles por
    grado, en metros. Es la variación de altura entre los 5 puntos de un mismo pulso del láser,
    separados unos 25 m; el ruido del instrumento es de unos 0,15 m. Donde no hubo medición, el
    producto rellena con valores vecinos. 265 MB.

Salidas:
  - src/features/landing/luna-lola.webp: relieve sombreado de toda la Luna para la portada
    (equirrectangular, longitud de −180 a 180, norte arriba). Es relieve, no una fotografía: el
    tono sale de la altura y de la luz, no del brillo real del suelo.
  - src/data/rugosidadLola.json: la rugosidad fina en cada región lunar de terrenoReal.json y la
    de toda la Luna como referencia.

Uso:  python scripts/luna/calcular.py --ldem RUTA/ldem_64_float.img --ldrm RUTA/ldrm_32_50_float.img
Necesita numpy y pillow (scripts/terreno/requirements.txt).
"""

import argparse
import datetime
import json
import math
import pathlib

import numpy as np
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parents[2]
TERRAIN = ROOT / "src" / "data" / "terrenoReal.json"
TEXTURE = ROOT / "src" / "features" / "landing" / "luna-lola.webp"
OUT = ROOT / "src" / "data" / "rugosidadLola.json"

SOURCE_URL = "https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/cylindrical/float_img/"
RADIUS_KM = 1737.4
LDEM_SHAPE = (11520, 23040)
LDRM_PPD = 32
LDRM_SHAPE = (5760, 11520)
#: 23040 / 9 = 2560 columnas: un píxel de la textura reúne 9 × 9 píxeles del relieve.
BLOCK = 9
TEXTURE_SIZE = (2048, 1024)


def read(path: str, shape: tuple[int, int]) -> np.memmap:
    """Lee el archivo sin cargarlo entero: flotantes de 32 bits, little endian (PC_REAL)."""
    expected = shape[0] * shape[1] * 4
    actual = pathlib.Path(path).stat().st_size
    if actual != expected:
        raise SystemExit(f"{path}: pesa {actual} bytes y se esperaban {expected} ({shape[1]} × {shape[0]} flotantes)")
    return np.memmap(path, dtype="<f4", mode="r", shape=shape)


def downsample(ldem: np.memmap) -> np.ndarray:
    """Promedio de bloques de BLOCK × BLOCK, leyendo de a una franja para no llenar la memoria."""
    rows, cols = ldem.shape
    out = np.empty((rows // BLOCK, cols // BLOCK), dtype=np.float32)
    for i in range(rows // BLOCK):
        band = np.asarray(ldem[i * BLOCK : (i + 1) * BLOCK], dtype=np.float32)
        out[i] = band.reshape(BLOCK, cols // BLOCK, BLOCK).mean(axis=(0, 2))
    return out


def shaded_relief(height_km: np.ndarray) -> np.ndarray:
    """Relieve sombreado en grises con la luz desde el oeste-noroeste, a 35° de altura.

    Las pendientes se calculan en kilómetros reales: hacia el este, la distancia entre columnas se
    acorta con el coseno de la latitud.
    """
    rows, cols = height_km.shape
    lat = 90 - (np.arange(rows) + 0.5) * 180 / rows
    dy = RADIUS_KM * math.radians(180 / rows)
    dx = (RADIUS_KM * math.radians(360 / cols) * np.maximum(np.cos(np.radians(lat)), 0.02))[:, None]
    z = height_km.astype(np.float64)
    dzdx = (np.roll(z, -1, axis=1) - np.roll(z, 1, axis=1)) / (2 * dx)
    dzdy = np.empty_like(z)
    dzdy[1:-1] = (z[:-2] - z[2:]) / (2 * dy)
    dzdy[0] = dzdy[1]
    dzdy[-1] = dzdy[-2]
    azimuth = math.radians(295)
    altitude = math.radians(35)
    lx = math.cos(altitude) * math.sin(azimuth)
    ly = math.cos(altitude) * math.cos(azimuth)
    lz = math.sin(altitude)
    shade = np.clip((-dzdx * lx - dzdy * ly + lz) / np.sqrt(dzdx**2 + dzdy**2 + 1), 0, 1)
    # Lo alto, un poco más claro: de −9 a +11 km.
    tone = 0.42 + 0.4 * np.clip((z + 9.0) / 20.0, 0, 1)
    value = tone * (0.22 + 1.05 * shade)
    rgb = np.stack([value, value * 0.985, value * 0.955], axis=-1)
    rgb = np.clip(rgb * 255, 0, 255).astype(np.uint8)
    # El archivo va de 0 a 360° este; la portada usa de −180 a 180.
    return np.roll(rgb, cols // 2, axis=1)


def great_circle_km(lat0: float, lon0: float, lats: np.ndarray, lons: np.ndarray) -> np.ndarray:
    phi1 = math.radians(lat0)
    phi2 = np.radians(lats)[:, None]
    dphi = phi2 - phi1
    dlam = np.radians(lons)[None, :] - math.radians(lon0)
    h = np.sin(dphi / 2) ** 2 + math.cos(phi1) * np.cos(phi2) * np.sin(dlam / 2) ** 2
    return 2 * RADIUS_KM * np.arcsin(np.sqrt(np.clip(h, 0, 1)))


def region_roughness(ldrm: np.memmap, lat0: float, lon0: float, radius_km: float) -> dict | None:
    """Mediana y cuartiles de la rugosidad en un círculo alrededor de la región."""
    ppd = LDRM_PPD
    dlat = math.degrees(radius_km / RADIUS_KM)
    r0 = max(0, int(math.floor((90 - min(90, lat0 + dlat)) * ppd)))
    r1 = min(LDRM_SHAPE[0] - 1, int(math.ceil((90 - max(-90, lat0 - dlat)) * ppd)))
    rows = np.arange(r0, r1 + 1)
    lats = 90 - (rows + 0.5) / ppd
    lon360 = lon0 % 360
    widest = max(abs(lats[0]), abs(lats[-1]))
    if widest >= 89.5:
        cols = np.arange(LDRM_SHAPE[1])
    else:
        dlon = dlat / math.cos(math.radians(widest))
        cols = np.arange(int(math.floor((lon360 - dlon) * ppd)), int(math.ceil((lon360 + dlon) * ppd)) + 1) % LDRM_SHAPE[1]
    block = np.asarray(ldrm[r0 : r1 + 1], dtype=np.float32)[:, cols]
    inside = great_circle_km(lat0, lon360, lats, (cols + 0.5) / ppd) <= radius_km
    values = block[inside]
    values = values[np.isfinite(values) & (values > 0)]
    if values.size < 20:
        return None
    q1, median, q3 = np.percentile(values, [25, 50, 75])
    return {"median": round(float(median), 2), "q1": round(float(q1), 2), "q3": round(float(q3), 2), "pixels": int(values.size)}


def moon_median(ldrm: np.memmap) -> float:
    """Mediana de toda la Luna, pesando cada píxel por su área (coseno de la latitud)."""
    step = 4
    rows = np.arange(0, LDRM_SHAPE[0], step)
    sample = np.asarray(ldrm[::step, ::step], dtype=np.float32)
    weights = np.repeat(np.cos(np.radians(90 - (rows + 0.5) / LDRM_PPD))[:, None], sample.shape[1], axis=1)
    keep = np.isfinite(sample) & (sample > 0)
    values = sample[keep]
    w = weights[keep]
    order = np.argsort(values)
    cumulative = np.cumsum(w[order])
    return round(float(values[order][np.searchsorted(cumulative, cumulative[-1] / 2)]), 2)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--ldem", required=True, help="ldem_64_float.img")
    parser.add_argument("--ldrm", required=True, help="ldrm_32_50_float.img")
    args = parser.parse_args()

    relief = shaded_relief(downsample(read(args.ldem, LDEM_SHAPE)))
    image = Image.fromarray(relief, "RGB").resize(TEXTURE_SIZE, Image.Resampling.LANCZOS)
    image.save(TEXTURE, "WEBP", quality=82, method=6)
    print(f"Textura: {TEXTURE.relative_to(ROOT)} ({TEXTURE.stat().st_size // 1024} KB)")

    ldrm = read(args.ldrm, LDRM_SHAPE)
    regions = json.loads(TERRAIN.read_text(encoding="utf-8"))["regions"]
    result = {}
    for region in regions:
        width, height = region["sizeKm"]
        # Círculo de la misma área que el recuadro de la región, centrado en ella.
        radius = math.sqrt(width * height / math.pi)
        result[region["id"]] = region_roughness(ldrm, region["latitude"], region["longitude"], radius)
        print(f"{region['name']}: {result[region['id']]}")
    reference = moon_median(ldrm)
    print(f"Mediana de toda la Luna: {reference} m")

    OUT.write_text(
        json.dumps(
            {
                "generatedAt": datetime.date.today().isoformat(),
                "source": {
                    "name": "LRO LOLA, LDRM_32_50: rugosidad mediana por píxel, 32 píxeles por grado",
                    "url": SOURCE_URL,
                    "baselineM": 25,
                    "noiseM": 0.15,
                },
                "method": "Círculo de la misma área que el recuadro de cada región; mediana y cuartiles de sus píxeles. "
                "Toda la Luna: mediana pesada por el área de cada píxel.",
                "moonMedian": reference,
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
