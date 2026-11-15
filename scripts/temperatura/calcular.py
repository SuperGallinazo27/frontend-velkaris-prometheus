"""Temperatura del suelo de cada lugar de la Tierra, medida por satélite (MODIS), para la aplicación.

Entradas: 16 GeoTIFF exportados con Google Earth Engine, de cobertura mundial y 1 km por píxel:
  MODIS_Day_T1..T4 y MODIS_Night_T1..T4, cada uno partido en dos mitades (…-0000000000.tif, de
  180° O a 29° E, y …-0000023296.tif, de 29° E a 180° E). La banda se llama LST_Day_1km o
  LST_Night_1km (temperatura de la superficie, «land surface temperature») y viene en °C.
  T1 a T4 son los trimestres: enero–marzo, abril–junio, julio–septiembre y octubre–diciembre.
  Los archivos no indican de qué años son ni si el satélite es Terra o Aqua.

Salida: src/data/temperaturaSuelo.json, con la media de día y de noche de cada trimestre en el
recuadro de 18 km de cada lugar de src/features/world/places.json.

Los archivos pesan unos 800 MB cada uno (12,8 GB en total) y no se guardan en el repositorio. El
script los lee de dos maneras:
  --dir CARPETA   los .tif ya descomprimidos
  --zips CARPETA  los .zip tal como se descargan de Google Drive; cada .tif se descomprime en
                  --tmp, se lee y se borra, así que hacen falta menos de 2 GB libres
Guarda el avance después de cada archivo: si se interrumpe, al repetirlo continúa donde quedó.

Uso:  python scripts/temperatura/calcular.py --zips RUTA/Descargas --tmp RUTA/carpeta-vacia
Necesita numpy y rasterio (scripts/terreno/requirements.txt).
"""

import argparse
import datetime
import json
import math
import pathlib
import re
import shutil
import zipfile

import numpy as np
import rasterio
from rasterio.windows import Window

ROOT = pathlib.Path(__file__).resolve().parents[2]
PLACES = ROOT / "src" / "features" / "world" / "places.json"
OUT = ROOT / "src" / "data" / "temperaturaSuelo.json"

#: El mismo recuadro que se analiza y se ve en el mapa de cada lugar.
AREA_KM = 18
KM_PER_DEGREE = 111.32
QUARTERS = ["enero a marzo", "abril a junio", "julio a septiembre", "octubre a diciembre"]
NAME = re.compile(r"MODIS_(Day|Night)_T([1-4])-\d{10}-(\d{10})\.tif$")
#: Si menos de esta parte del recuadro tiene dato, no se publica el valor.
MIN_COVERAGE = 0.2


def box_window(src: rasterio.DatasetReader, lat: float, lon: float) -> Window | None:
    """Ventana de píxeles del recuadro de AREA_KM alrededor del punto, o None si cae fuera del archivo."""
    half_lat = AREA_KM / 2 / KM_PER_DEGREE
    half_lon = half_lat / max(math.cos(math.radians(lat)), 0.05)
    left, right = lon - half_lon, lon + half_lon
    bottom, top = lat - half_lat, lat + half_lat
    b = src.bounds
    if left < b.left or right > b.right or bottom < b.bottom or top > b.top:
        return None
    row0, col0 = src.index(left, top)
    row1, col1 = src.index(right, bottom)
    return Window(col0, row0, max(1, col1 - col0 + 1), max(1, row1 - row0 + 1))


def sample(path: pathlib.Path, places: list[dict]) -> dict[str, dict]:
    """Media del recuadro de cada lugar que cae dentro de este archivo."""
    result = {}
    with rasterio.open(path) as src:
        if src.crs is None or src.crs.to_epsg() != 4326:
            raise SystemExit(f"{path.name}: se esperaba EPSG:4326 y trae {src.crs}")
        for place in places:
            window = box_window(src, place["latitude"], place["longitude"])
            if window is None:
                continue
            block = src.read(1, window=window).astype(np.float64)
            valid = np.isfinite(block)
            coverage = float(valid.mean())
            result[place["id"]] = {
                "value": round(float(block[valid].mean()), 1) if coverage >= MIN_COVERAGE else None,
                "coverage": round(coverage, 2),
            }
    return result


def find_inputs(args: argparse.Namespace) -> dict[tuple[str, int, str], tuple[pathlib.Path, str | None]]:
    """(día/noche, trimestre, mitad) → (archivo, miembro del zip o None)."""
    found: dict[tuple[str, int, str], tuple[pathlib.Path, str | None]] = {}
    if args.dir:
        for path in sorted(pathlib.Path(args.dir).rglob("*.tif")):
            match = NAME.search(path.name)
            if match:
                found.setdefault((match[1], int(match[2]), match[3]), (path, None))
    if args.zips:
        for path in sorted(pathlib.Path(args.zips).glob("TEMPERATURA LUNAR TIERRA*.zip")):
            with zipfile.ZipFile(path) as archive:
                for member in archive.namelist():
                    match = NAME.search(member)
                    if match:
                        found.setdefault((match[1], int(match[2]), match[3]), (path, member))
    return found


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--dir", help="carpeta con los .tif descomprimidos")
    parser.add_argument("--zips", help="carpeta con los .zip de Google Drive")
    parser.add_argument("--tmp", help="carpeta vacía para descomprimir de a un archivo (con --zips)")
    args = parser.parse_args()
    if not args.dir and not args.zips:
        parser.error("indica --dir o --zips")
    if args.zips and not args.tmp:
        parser.error("con --zips hace falta --tmp")

    places = json.loads(PLACES.read_text(encoding="utf-8"))
    inputs = find_inputs(args)
    missing = [f"{kind} T{q}" for kind in ("Day", "Night") for q in (1, 2, 3, 4) if not any(k[:2] == (kind, q) for k in inputs)]
    if missing:
        raise SystemExit(f"Faltan archivos: {', '.join(missing)}")

    tmp = pathlib.Path(args.tmp) if args.tmp else None
    progress_path = (tmp or pathlib.Path(args.dir)) / "avance-temperatura.json"
    progress: dict[str, dict] = json.loads(progress_path.read_text(encoding="utf-8")) if progress_path.exists() else {}

    for key in sorted(inputs):
        label = "|".join(map(str, key))
        if label in progress:
            continue
        path, member = inputs[key]
        if member:
            assert tmp is not None
            tmp.mkdir(parents=True, exist_ok=True)
            target = tmp / pathlib.PurePosixPath(member).name
            if not target.exists():
                partial = target.with_suffix(".parcial")
                with zipfile.ZipFile(path) as archive, archive.open(member) as source, open(partial, "wb") as sink:
                    shutil.copyfileobj(source, sink, 16 * 1024 * 1024)
                partial.rename(target)
            progress[label] = sample(target, places)
            target.unlink()
        else:
            progress[label] = sample(path, places)
        progress_path.write_text(json.dumps(progress), encoding="utf-8")
        print(f"{label}: {len(progress[label])} lugares", flush=True)

    sites = {}
    for place in places:
        entry: dict[str, list] = {"day": [None] * 4, "night": [None] * 4, "coverage": [None] * 4}
        for label, values in progress.items():
            kind, quarter, _ = label.split("|")
            hit = values.get(place["id"])
            if hit is None:
                continue
            index = int(quarter) - 1
            entry["day" if kind == "Day" else "night"][index] = hit["value"]
            if kind == "Day":
                entry["coverage"][index] = hit["coverage"]
        sites[place["id"]] = entry if any(v is not None for v in entry["day"] + entry["night"]) else None
        print(place["name"], sites[place["id"]])

    OUT.write_text(
        json.dumps(
            {
                "generatedAt": datetime.date.today().isoformat(),
                "source": {
                    "name": "MODIS, temperatura de la superficie del suelo (LST) a 1 km",
                    "url": "https://lpdaac.usgs.gov/products/mod11a1v061/",
                    "bands": ["LST_Day_1km", "LST_Night_1km"],
                    "resolutionM": 1000,
                    "note": "Promedios por trimestre exportados con Google Earth Engine. Los archivos no indican de qué años son ni si el satélite es Terra o Aqua.",
                },
                "method": f"Media de los píxeles con dato dentro del recuadro de {AREA_KM} km de cada lugar. Sin valor si menos del {int(MIN_COVERAGE * 100)} % del recuadro tiene dato.",
                "quarters": QUARTERS,
                "sites": sites,
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
