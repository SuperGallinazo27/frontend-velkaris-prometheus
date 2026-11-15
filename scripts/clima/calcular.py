"""Descarga el clima típico de cada lugar del mundo interactivo.

Fuente: NASA POWER, climatología mensual (promedio de 2001 a 2025). Una consulta por lugar.
No necesita dependencias: solo la biblioteca estándar de Python.

Uso:  python scripts/clima/calcular.py
Sale: src/data/climaReal.json
"""

import datetime
import json
import pathlib
import time
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[2]
PLACES = ROOT / "src" / "features" / "world" / "places.json"
OUT = ROOT / "src" / "data" / "climaReal.json"

API = "https://power.larc.nasa.gov/api/temporal/climatology/point"
#: Temperatura media, amplitud térmica diaria, precipitación del mes, viento medio y nubosidad.
PARAMETERS = ["T2M", "T2M_RANGE", "PRECTOTCORR_SUM", "WS10M", "CLOUD_AMT"]
MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]
MISSING = -999


def fetch(latitude: float, longitude: float) -> dict:
    query = urllib.parse.urlencode(
        {
            "parameters": ",".join(PARAMETERS),
            "community": "AG",
            "latitude": latitude,
            "longitude": longitude,
            "format": "JSON",
        }
    )
    for attempt in range(4):
        try:
            with urllib.request.urlopen(f"{API}?{query}", timeout=90) as response:
                return json.loads(response.read().decode("utf-8"))
        except OSError:
            if attempt == 3:
                raise
            time.sleep(3 * (attempt + 1))
    raise RuntimeError("sin respuesta")


def value(series: dict, month: str, digits: int):
    """Un valor mensual; None si el servicio lo marca como ausente."""
    number = series.get(month)
    if number is None or number <= MISSING:
        return None
    return round(number, digits)


def site(place: dict) -> dict:
    data = fetch(place["latitude"], place["longitude"])
    parameter = data["properties"]["parameter"]
    months = [
        {
            # °C: media del mes y diferencia típica entre la máxima y la mínima del día.
            "temperature": value(parameter["T2M"], month, 1),
            "range": value(parameter["T2M_RANGE"], month, 1),
            # mm acumulados en el mes.
            "precipitation": value(parameter["PRECTOTCORR_SUM"], month, 0),
            # m/s a 10 m de altura.
            "wind": value(parameter["WS10M"], month, 1),
            # % de cielo cubierto.
            "cloud": value(parameter["CLOUD_AMT"], month, 0),
        }
        for month in MONTHS
    ]
    return {
        "id": place["id"],
        "latitude": place["latitude"],
        "longitude": place["longitude"],
        # Altitud media de la celda del modelo: sirve para ajustar la temperatura a la altitud real del lugar.
        "cellElevation": round(data["geometry"]["coordinates"][2]),
        "months": months,
    }, data["header"]["title"]


def main():
    places = json.loads(PLACES.read_text(encoding="utf-8"))
    sites = []
    title = ""
    for place in places:
        result, title = site(place)
        sites.append(result)
        july = result["months"][6]
        print(f"{place['name']:<26} celda a {result['cellElevation']:>5} m  julio {july['temperature']} °C  {july['precipitation']} mm")
        time.sleep(0.5)

    OUT.write_text(
        json.dumps(
            {
                "generatedAt": datetime.date.today().isoformat(),
                "source": {
                    "name": "NASA POWER, climatología mensual",
                    "detail": title,
                    "url": "https://power.larc.nasa.gov/",
                    "period": "2001-2025",
                    "note": "Promedios de una celda de unos 50 km (MERRA-2). No son mediciones de una estación en el lugar.",
                },
                "sites": sites,
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
        newline="\n",
    )
    print(f"\nEscrito {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
