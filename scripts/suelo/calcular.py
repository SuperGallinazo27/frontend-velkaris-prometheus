"""Descarga la textura del suelo superficial de cada lugar del mundo interactivo.

Fuente: SoilGrids 2.0 (ISRIC), mapa mundial de suelos a 250 m, capa de 0 a 5 cm: arena, limo,
arcilla y densidad aparente. Es la PREDICCIÓN de un modelo, no una medición en el lugar, y no da
datos sobre glaciares, roca desnuda o agua. Licencia CC BY 4.0; cita: Poggio y otros (2021),
SOIL 7, 217-240, https://doi.org/10.5194/soil-7-217-2021.

El servicio está en fase beta, admite 5 consultas por minuto y a veces tarda casi un minuto en
responder. Por eso el script guarda cada lugar en cuanto llega, sigue si uno falla y, al volver a
ejecutarlo, solo consulta los que faltan. No necesita dependencias: solo la biblioteca estándar.

Uso:  python scripts/suelo/calcular.py            (consulta los lugares que faltan)
      python scripts/suelo/calcular.py --todo     (vuelve a consultar todos)
Sale: src/data/sueloReal.json
      "sites": lugar → textura, o null si el mapa no tiene dato ahí (glaciar, roca, agua).
      "failed": lugares que no se pudieron consultar; no aparecen en "sites".
"""

import datetime
import json
import pathlib
import sys
import time
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[2]
PLACES = ROOT / "src" / "features" / "world" / "places.json"
OUT = ROOT / "src" / "data" / "sueloReal.json"

API = "https://rest.isric.org/soilgrids/v2.0/properties/query"
PROPERTIES = ["sand", "silt", "clay", "bdod"]
DEPTH = "0-5cm"
#: 5 consultas por minuto como máximo.
PAUSE_S = 13
TIMEOUT_S = 150
ATTEMPTS = 3

SOURCE = {
    "name": "SoilGrids 2.0 (ISRIC), predicción a 250 m",
    "depth": DEPTH,
    "license": "CC BY 4.0",
    "citation": "Poggio y otros (2021), SOIL 7, 217-240",
    "url": "https://doi.org/10.5194/soil-7-217-2021",
    "units": "arena, limo y arcilla en %; densidad aparente en g/cm³",
}


def fetch(latitude: float, longitude: float) -> dict:
    query = urllib.parse.urlencode(
        [("lon", longitude), ("lat", latitude)]
        + [("property", name) for name in PROPERTIES]
        + [("depth", DEPTH), ("value", "mean")]
    )
    request = urllib.request.Request(f"{API}?{query}", headers={"Accept": "application/json"})
    for attempt in range(ATTEMPTS):
        try:
            with urllib.request.urlopen(request, timeout=TIMEOUT_S) as response:
                return json.loads(response.read().decode("utf-8"))
        except OSError:
            if attempt == ATTEMPTS - 1:
                raise
            time.sleep(PAUSE_S * (attempt + 2))
    raise RuntimeError("sin respuesta")


def texture(data: dict):
    """Arena, limo y arcilla en %, densidad en g/cm³; None si el mapa no tiene dato aquí."""
    values = {}
    for layer in data["properties"]["layers"]:
        factor = layer["unit_measure"]["d_factor"]
        mean = layer["depths"][0]["values"]["mean"]
        values[layer["name"]] = None if mean is None else mean / factor
    if any(values.get(name) is None for name in PROPERTIES):
        return None
    return {
        "sand": round(values["sand"], 1),
        "silt": round(values["silt"], 1),
        "clay": round(values["clay"], 1),
        "bulkDensity": round(values["bdod"], 2),
    }


def save(sites: dict, failed: list) -> None:
    OUT.write_text(
        json.dumps(
            {"source": {**SOURCE, "fetched": datetime.date.today().isoformat()}, "sites": sites, "failed": failed},
            ensure_ascii=False,
            indent=1,
        )
        + "\n",
        encoding="utf-8",
    )


def main() -> None:
    places = json.loads(PLACES.read_text(encoding="utf-8"))
    previous = {}
    if OUT.exists() and "--todo" not in sys.argv:
        previous = json.loads(OUT.read_text(encoding="utf-8")).get("sites", {})
    sites = {place["id"]: previous[place["id"]] for place in places if place["id"] in previous}
    failed = []
    pending = [place for place in places if place["id"] not in sites]
    print(f"{len(sites)} lugares ya consultados, faltan {len(pending)}", flush=True)
    for index, place in enumerate(pending):
        if index:
            time.sleep(PAUSE_S)
        try:
            sites[place["id"]] = texture(fetch(place["latitude"], place["longitude"]))
            print(f"{place['name']}: {sites[place['id']]}", flush=True)
        except (OSError, KeyError, ValueError) as error:
            failed.append(place["id"])
            print(f"{place['name']}: no se pudo consultar ({error})", flush=True)
        save(sites, failed)
    save(sites, failed)
    empty = [name for name, value in sites.items() if value is None]
    print(
        f"Escrito {OUT.relative_to(ROOT)}: {len(sites) - len(empty)} con dato, "
        f"{len(empty)} sin dato del mapa, {len(failed)} sin consultar ({', '.join(failed) or 'ninguno'})",
        flush=True,
    )


if __name__ == "__main__":
    main()
