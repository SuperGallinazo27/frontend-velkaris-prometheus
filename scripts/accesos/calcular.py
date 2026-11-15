"""Accesos de cada lugar: aeropuerto, carretera, poblado y hospital más cercanos, de OpenStreetMap.

Una campaña necesita saber cómo se llega. Para cada lugar de src/features/world/places.json se
consulta la base de OpenStreetMap con su servicio público Overpass y se guarda en
src/data/accesos.json:
  - el aeropuerto con código IATA más cercano (hasta 600 km);
  - la carretera más cercana (autopista, troncal, primaria, secundaria o terciaria, hasta 60 km)
    y el camino o pista más cercano (hasta 15 km);
  - el poblado más cercano (ciudad, pueblo o aldea, hasta 150 km);
  - el hospital más cercano (hasta 300 km).

Las distancias son en línea recta desde el punto del lugar, no por carretera. OpenStreetMap lo
mantienen voluntarios: en zonas remotas puede faltar un camino o un puesto de salud.
Datos © colaboradores de OpenStreetMap, licencia ODbL.

Uso:  python scripts/accesos/calcular.py            # los lugares que falten
      python scripts/accesos/calcular.py --todo     # volver a consultar todos
Solo necesita Python 3 e internet. Busca de cerca a lejos (amplía el radio solo si no encuentra
nada), con pausas; si el servicio está ocupado espera y reintenta, y guarda cada lugar en cuanto
llega. Tarda unos 20 minutos.
"""

import argparse
import datetime
import json
import math
import pathlib
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[2]
PLACES = ROOT / "src" / "features" / "world" / "places.json"
OUT = ROOT / "src" / "data" / "accesos.json"

ENDPOINTS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]
USER_AGENT = "prometheus-accesos/1.0 (proyecto educativo)"
EARTH_RADIUS_KM = 6371.0088
#: Pausa tras cada consulta: el servicio es compartido.
PAUSE_S = 1.5

AIRPORT_KM = 600
ROAD_KM = 60
TRACK_KM = 15
TOWN_KM = 150
HOSPITAL_KM = 300
ROAD_CLASSES = ["motorway", "trunk", "primary", "secondary", "tertiary"]
ROAD_NAMES = {"motorway": "autopista", "trunk": "carretera troncal", "primary": "carretera principal",
              "secondary": "carretera secundaria", "tertiary": "carretera local", "track": "pista", "unclassified": "camino"}
TOWN_NAMES = {"city": "ciudad", "town": "pueblo", "village": "aldea"}


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    h = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2
    return 2 * EARTH_RADIUS_KM * math.asin(min(1.0, math.sqrt(h)))


#: Radios de búsqueda, de cerca a lejos, en km. Se amplía solo si en el anterior no hubo nada: así
#: cada consulta es pequeña, también en regiones con miles de carreteras o de hospitales.
STAGES = {
    "airport": [150, 300, AIRPORT_KM],
    "town": [25, 75, TOWN_KM],
    "hospital": [50, 150, HOSPITAL_KM],
    "road": [3, 12, 30, ROAD_KM],
    "track": [1, 5, TRACK_KM],
}
FILTERS = {
    "airport": 'nwr["aeroway"="aerodrome"]["iata"]',
    "town": 'node["place"~"^(city|town|village)$"]["name"]',
    "hospital": 'nwr["amenity"="hospital"]',
    "road": 'way["highway"~"^(' + "|".join(ROAD_CLASSES) + ')$"]',
    "track": 'way["highway"~"^(track|unclassified)$"]',
}


def overpass(text: str) -> dict:
    """Consulta con paciencia: el servicio es gratuito y compartido."""
    data = urllib.parse.urlencode({"data": text}).encode("utf-8")
    for attempt in range(8):
        endpoint = ENDPOINTS[attempt % len(ENDPOINTS)]
        request = urllib.request.Request(endpoint, data=data, headers={"User-Agent": USER_AGENT})
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                return json.load(response)
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, ValueError, OSError):
            time.sleep(10 * (attempt + 1))
    raise SystemExit("Overpass no respondió tras varios intentos; vuelve a ejecutar el script más tarde.")


def search(kind: str, lat: float, lon: float) -> list[dict]:
    """Lo que hay de un tipo alrededor del punto, ampliando el radio hasta encontrar algo."""
    output = "out geom tags;" if kind in ("road", "track") else "out center tags;"
    for radius in STAGES[kind]:
        text = f'[out:json][timeout:90];{FILTERS[kind]}(around:{radius * 1000},{lat},{lon});{output}'
        elements = overpass(text).get("elements", [])
        time.sleep(PAUSE_S)
        if elements:
            return elements
    return []


def position(element: dict) -> tuple[float, float] | None:
    if "lat" in element:
        return element["lat"], element["lon"]
    center = element.get("center")
    return (center["lat"], center["lon"]) if center else None


def nearest_point(elements: list[dict], lat: float, lon: float, keep) -> tuple[float, dict] | None:
    best = None
    for element in elements:
        if not keep(element):
            continue
        where = position(element)
        if where is None:
            continue
        distance = haversine_km(lat, lon, *where)
        if best is None or distance < best[0]:
            best = (distance, element)
    return best


def nearest_way(elements: list[dict], lat: float, lon: float, classes: list[str]) -> tuple[float, dict] | None:
    """La vía más cercana, midiendo hasta cada uno de sus puntos."""
    best = None
    for element in elements:
        if element.get("type") != "way" or element.get("tags", {}).get("highway") not in classes:
            continue
        for node in element.get("geometry", []):
            distance = haversine_km(lat, lon, node["lat"], node["lon"])
            if best is None or distance < best[0]:
                best = (distance, element)
    return best


def km(value: float) -> float:
    return round(value, 1) if value < 10 else float(round(value))


def read(place: dict) -> dict:
    lat, lon = place["latitude"], place["longitude"]
    tags = lambda element: element.get("tags", {})
    result: dict = {}

    airport = nearest_point(search("airport", lat, lon), lat, lon, lambda e: bool(tags(e).get("iata")))
    result["airport"] = airport and {
        "name": tags(airport[1]).get("name:es") or tags(airport[1]).get("name") or tags(airport[1]).get("name:en"),
        "iata": tags(airport[1])["iata"], "distanceKm": km(airport[0]),
    }

    town = nearest_point(search("town", lat, lon), lat, lon, lambda e: tags(e).get("place") in TOWN_NAMES)
    result["town"] = town and {
        "name": tags(town[1]).get("name:es") or tags(town[1]).get("name"),
        "kind": TOWN_NAMES[tags(town[1])["place"]], "distanceKm": km(town[0]),
    }

    hospital = nearest_point(search("hospital", lat, lon), lat, lon, lambda e: True)
    result["hospital"] = hospital and {
        "name": tags(hospital[1]).get("name:es") or tags(hospital[1]).get("name"), "distanceKm": km(hospital[0]),
    }

    road = nearest_way(search("road", lat, lon), lat, lon, ROAD_CLASSES)
    result["road"] = road and {
        "kind": ROAD_NAMES[tags(road[1])["highway"]], "name": tags(road[1]).get("ref") or tags(road[1]).get("name"),
        "distanceKm": km(road[0]),
    }
    track = nearest_way(search("track", lat, lon), lat, lon, ["track", "unclassified"])
    result["track"] = track and {"kind": ROAD_NAMES[tags(track[1])["highway"]], "distanceKm": km(track[0])}
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--todo", action="store_true", help="vuelve a consultar también los lugares ya guardados")
    parser.add_argument("--solo", help="id de un lugar, para probar")
    args = parser.parse_args()

    places = json.loads(PLACES.read_text(encoding="utf-8"))
    done = json.loads(OUT.read_text(encoding="utf-8")).get("places", {}) if OUT.exists() else {}
    for place in places:
        if args.solo and place["id"] != args.solo:
            continue
        if place["id"] in done and not args.todo and not args.solo:
            continue
        done[place["id"]] = read(place)
        print(f"{place['name']}: {json.dumps(done[place['id']], ensure_ascii=False)}", flush=True)
        OUT.write_text(
            json.dumps(
                {
                    "generatedAt": datetime.date.today().isoformat(),
                    "source": {
                        "name": "© colaboradores de OpenStreetMap, vía Overpass API",
                        "url": "https://www.openstreetmap.org/copyright",
                        "license": "ODbL",
                    },
                    "method": "Distancias en línea recta desde el punto del lugar. Aeropuerto: el más cercano con código IATA. "
                    "Carretera: de autopista a terciaria. Poblado: ciudad, pueblo o aldea con nombre.",
                    "limits": {"airportKm": AIRPORT_KM, "roadKm": ROAD_KM, "trackKm": TRACK_KM, "townKm": TOWN_KM, "hospitalKm": HOSPITAL_KM},
                    "places": done,
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
