"""Temperatura del suelo de cada región lunar, medida por el radiómetro Diviner (LRO, NASA).

Entrada: los «Global Cumulative Products» (GCP) de Diviner en el PDS Geosciences Node:
https://pds-geosciences.wustl.edu/lro/urn-nasa-pds-lro_diviner_derived1/data_derived_gcp/
Son tablas de texto, una por franja de 10° de latitud (156 MB cada una), con la temperatura de
brillo bolométrica (columna tbol, en kelvin) promediada en celdas de 0,5° de latitud y longitud y
cada cuarto de hora de hora local, con todas las observaciones al nadir de julio de 2009 a abril
de 2015. −9999 es «sin observaciones». Referencia: Williams et al. (2017), «The global surface
temperatures of the Moon as measured by the Diviner Lunar Radiometer Experiment», Icarus 283.

Salida: src/data/temperaturaLuna.json, con la temperatura más alta y más baja del ciclo día-noche
en cada región lunar de src/data/terrenoReal.json.

El script lee las tablas directamente de internet, sin guardarlas: solo las franjas que tocan
alguna región (unos 940 MB en total). Con --dir usa las tablas ya descargadas en una carpeta.

Uso:  python scripts/luna/temperatura.py [--dir CARPETA]
Solo necesita Python 3 (sin paquetes).
"""

import argparse
import datetime
import json
import math
import pathlib
import statistics
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[2]
TERRAIN = ROOT / "src" / "data" / "terrenoReal.json"
OUT = ROOT / "src" / "data" / "temperaturaLuna.json"

SOURCE_URL = "https://pds-geosciences.wustl.edu/lro/urn-nasa-pds-lro_diviner_derived1/data_derived_gcp/"
RADIUS_KM = 1737.4
BIN_DEG = 0.5
#: Horas locales posibles en cada celda: 24 h en pasos de un cuarto de hora.
LOCAL_TIMES = 96
#: Una celda con menos horas observadas que estas no da un máximo ni un mínimo fiables.
MIN_TIMES = 48


def band_name(lat: float) -> str:
    """Nombre de la tabla que contiene esa latitud: «00n10n», «90s80s»…"""
    low = min(int(math.floor(lat / 10) * 10), 80)
    high = low + 10
    tag = lambda v: f"{abs(v):02d}{'n' if v > 0 or (v == 0 and low >= 0) else 's'}"
    return f"{tag(low)}{tag(high)}"


def great_circle_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    h = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2
    return 2 * RADIUS_KM * math.asin(min(1.0, math.sqrt(h)))


def lines_of(band: str, folder: str | None):
    name = f"global_cumul_avg_cyl_{band}_002.tab"
    if folder:
        with open(pathlib.Path(folder) / name, encoding="ascii") as handle:
            yield from handle
        return
    with urllib.request.urlopen(SOURCE_URL + name, timeout=120) as response:
        for raw in response:
            yield raw.decode("ascii")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--dir", help="carpeta con las tablas .tab ya descargadas")
    args = parser.parse_args()

    regions = json.loads(TERRAIN.read_text(encoding="utf-8"))["regions"]
    wanted: dict[str, list[dict]] = {}
    for region in regions:
        width, height = region["sizeKm"]
        # Círculo de la misma área que el recuadro de la región; nunca menor que media celda.
        region["_radius"] = max(math.sqrt(width * height / math.pi), RADIUS_KM * math.radians(BIN_DEG) / 2)
        region["_cells"] = {}
        # Una región puede asomarse a la franja vecina.
        reach = math.degrees(region["_radius"] / RADIUS_KM)
        for lat in {region["latitude"] - reach, region["latitude"], region["latitude"] + reach}:
            wanted.setdefault(band_name(max(-89.99, min(89.99, lat))), []).append(region)

    for band in sorted(wanted):
        group = {r["id"]: r for r in wanted[band]}.values()
        lat_low = min(r["latitude"] for r in group) - 1.5
        lat_high = max(r["latitude"] for r in group) + 1.5
        rows = 0
        for line in lines_of(band, args.dir):
            rows += 1
            if rows == 1:
                continue
            lat = float(line[8:15])
            if lat < lat_low or lat > lat_high:
                continue
            tbol = float(line[line.rfind(",") + 1 :])
            if tbol <= 0:
                continue
            lon = float(line[0:7])
            for region in group:
                if abs(lat - region["latitude"]) * 30.32 > region["_radius"] + 8:
                    continue
                if great_circle_km(region["latitude"], region["longitude"], lat, lon) <= region["_radius"]:
                    region["_cells"].setdefault((lon, lat), []).append(tbol)
        print(f"{band}: {rows - 1} filas leídas", flush=True)

    result = {}
    for region in regions:
        cells = [values for values in region["_cells"].values() if len(values) >= MIN_TIMES]
        if not cells:
            result[region["id"]] = None
            print(f"{region['name']}: sin celdas con datos suficientes")
            continue
        result[region["id"]] = {
            "maxK": round(statistics.median(max(v) for v in cells), 1),
            "minK": round(statistics.median(min(v) for v in cells), 1),
            "cells": len(cells),
            "hours": round(statistics.median(len(v) for v in cells) / LOCAL_TIMES, 2),
        }
        print(f"{region['name']}: {result[region['id']]}")

    OUT.write_text(
        json.dumps(
            {
                "generatedAt": datetime.date.today().isoformat(),
                "source": {
                    "name": "LRO Diviner, productos globales acumulados (GCP): temperatura bolométrica de brillo",
                    "url": SOURCE_URL,
                    "reference": "Williams et al. (2017), Icarus 283, 300-325",
                    "period": "2009-2015",
                    "binDeg": BIN_DEG,
                    "localTimeH": 0.25,
                },
                "method": "Celdas de 0,5° dentro de un círculo de la misma área que el recuadro de cada región. "
                "De cada celda, la temperatura más alta y la más baja del ciclo día-noche; de la región, la mediana "
                f"de sus celdas. Solo cuentan las celdas con al menos {MIN_TIMES} de las {LOCAL_TIMES} horas locales observadas.",
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
