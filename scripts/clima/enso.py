"""Estado de El Niño / La Niña, de NOAA, para la aplicación.

Guarda en src/data/enso.json una copia con fecha de dos índices del Climate Prediction Center:
  - ONI (Oceanic Niño Index): anomalía de la temperatura del mar en la región Niño 3.4, promedio
    móvil de tres meses. https://www.cpc.ncep.noaa.gov/data/indices/oni.ascii.txt
  - Temperatura semanal del mar en las regiones Niño, incluida la Niño 1+2, frente a Ecuador y
    Perú. https://www.cpc.ncep.noaa.gov/data/indices/wksst9120.for

La aplicación usa esta copia cuando no hay servidor; con servidor, el dato se pide en vivo a
`/api/v1/climate/enso`, que lee las mismas dos fuentes. NOAA no permite leerlas desde el navegador.

Uso:  python scripts/clima/enso.py
Solo necesita Python 3 e internet.
"""

import datetime
import json
import pathlib
import re
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / "src" / "data" / "enso.json"
ONI_URL = "https://www.cpc.ncep.noaa.gov/data/indices/oni.ascii.txt"
WEEKLY_URL = "https://www.cpc.ncep.noaa.gov/data/indices/wksst9120.for"
MONTHS = {m: i + 1 for i, m in enumerate("JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC".split())}
#: Cuántos trimestres seguidos se guardan: con cinco se sabe si hay un episodio declarado.
RECENT = 5

ONI_LINE = re.compile(r"^\s*([A-Z]{3})\s+(\d{4})\s+(-?\d+\.\d+)\s+(-?\d+\.\d+)\s*$")
WEEK_LINE = re.compile(r"^\s*(\d{2})([A-Z]{3})(\d{4})" + r"\s+(\d+\.\d)\s*(-?\d+\.\d)" * 4 + r"\s*$")


def fetch(url: str) -> str:
    request = urllib.request.Request(url, headers={"User-Agent": "prometheus-clima/1.0"})
    with urllib.request.urlopen(request, timeout=60) as response:
        return response.read().decode("ascii", errors="replace")


def parse_oni(text: str) -> list[dict]:
    rows = []
    for line in text.splitlines():
        match = ONI_LINE.match(line)
        if match:
            rows.append({"season": match[1], "year": int(match[2]), "oni": float(match[4])})
    if len(rows) < RECENT:
        raise SystemExit("El archivo del ONI no trae filas reconocibles")
    return rows


def parse_weekly(text: str) -> dict:
    last = None
    for line in text.splitlines():
        match = WEEK_LINE.match(line)
        if match:
            last = match
    if last is None:
        raise SystemExit("El archivo semanal no trae filas reconocibles")
    date = datetime.date(int(last[3]), MONTHS[last[2]], int(last[1]))
    return {
        "week": date.isoformat(),
        "nino12": {"sst": float(last[4]), "anomaly": float(last[5])},
        "nino34": {"sst": float(last[8]), "anomaly": float(last[9])},
    }


def main() -> None:
    oni = parse_oni(fetch(ONI_URL))
    weekly = parse_weekly(fetch(WEEKLY_URL))
    data = {
        "fetchedAt": datetime.date.today().isoformat(),
        "source": {"name": "NOAA Climate Prediction Center", "oni": ONI_URL, "weekly": WEEKLY_URL},
        "recent": oni[-RECENT:],
        "weekly": weekly,
    }
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(json.dumps(data, ensure_ascii=False))
    print(f"Escrito {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
