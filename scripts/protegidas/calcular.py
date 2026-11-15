"""Áreas protegidas en cada lugar del mundo interactivo, para el portal de turnos.

Fuente: World Database on Protected and Conserved Areas (WDPCA), de UNEP-WCMC y la UICN, a través
de su servicio público de mapas (ArcGIS). La base se publica cada mes en
https://www.protectedplanet.net/ y reúne las áreas protegidas que declaran los países y las de
convenios internacionales (Patrimonio Mundial, Ramsar, Reservas de la Biosfera).

Para cada lugar de `src/features/world/places.json` se hacen tres consultas:
  1. los polígonos que contienen el punto del lugar: son los que deciden si se puede reservar;
  2. los polígonos que tocan el recuadro de 18 km que se analiza: «cercanas», solo informativas;
  3. las áreas que la base solo tiene como un punto, sin límites, dentro de ese recuadro: también
     informativas, porque sin polígono no se puede saber si contienen el lugar.

No se inventa nada: los atributos se guardan como vienen del servicio. Un lugar sin polígono en su
punto queda como «sin área protegida en el punto», lo que no garantiza que no exista una: la base
puede estar incompleta o tener límites imprecisos.

El script guarda cada lugar en cuanto llega, sigue si uno falla y, al volver a ejecutarlo, solo
consulta los que faltan. Solo usa la biblioteca estándar.

Uso:  python scripts/protegidas/calcular.py            (consulta los lugares que faltan)
      python scripts/protegidas/calcular.py --todo     (vuelve a consultar todos)
      python scripts/protegidas/calcular.py --backend RUTA   (carpeta del backend; por defecto,
                                                              ../velkaris-prometheus)
Sale: src/data/areasProtegidas.json            lo que muestra la aplicación.
      <backend>/data/lugares.json              el catálogo con el que el servidor aplica la regla.
"""

import datetime
import json
import math
import pathlib
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[2]
PLACES = ROOT / "src" / "features" / "world" / "places.json"
OUT = ROOT / "src" / "data" / "areasProtegidas.json"
DEFAULT_BACKEND = ROOT.parent / "velkaris-prometheus"

SERVICE = "https://data-gis.unep-wcmc.org/server/rest/services/ProtectedSites/The_World_Database_of_Protected_Areas/MapServer"
POINTS_LAYER = 0
POLYGONS_LAYER = 1
#: Lado del recuadro que se analiza alrededor de cada lugar, el mismo del mapa y del terreno.
BOX_KM = 18
EARTH_RADIUS_M = 6_371_008.8
FIELDS = [
    "site_id", "site_pid", "site_type", "name", "name_eng", "desig", "desig_eng", "desig_type",
    "iucn_cat", "realm", "rep_area", "status", "status_yr", "gov_type", "mang_auth", "iso3", "verif",
]
PAUSE_S = 1.0
TIMEOUT_S = 90
ATTEMPTS = 4
#: Cliente genérico: el servicio no pide identificación.
USER_AGENT = "Mozilla/5.0 (compatible; consulta-areas-protegidas/1.0)"


def get(url: str, params: dict) -> dict:
    """Una consulta al servicio, con reintentos espaciados."""
    request = urllib.request.Request(
        f"{url}?{urllib.parse.urlencode(params)}",
        headers={"Accept": "application/json", "User-Agent": USER_AGENT},
    )
    for attempt in range(ATTEMPTS):
        try:
            with urllib.request.urlopen(request, timeout=TIMEOUT_S) as response:
                data = json.loads(response.read().decode("utf-8"))
            if "error" in data:
                raise ValueError(f"el servicio respondió un error {data['error'].get('code')}")
            return data
        except (OSError, ValueError):
            if attempt == ATTEMPTS - 1:
                raise
            time.sleep(PAUSE_S * 4 * (attempt + 1))
    raise RuntimeError("sin respuesta")


def query(layer: int, geometry: str, geometry_type: str) -> list[dict]:
    data = get(
        f"{SERVICE}/{layer}/query",
        {
            "where": "1=1",
            "geometry": geometry,
            "geometryType": geometry_type,
            "inSR": 4326,
            "spatialRel": "esriSpatialRelIntersects",
            "outFields": ",".join(FIELDS),
            "returnGeometry": "false",
            "f": "json",
        },
    )
    if data.get("exceededTransferLimit"):
        raise ValueError("el servicio recortó la respuesta: hay más áreas de las que devuelve una consulta")
    time.sleep(PAUSE_S)
    return [feature["attributes"] for feature in data.get("features", [])]


def text(value) -> str | None:
    """Texto limpio, o None si el campo viene vacío."""
    if value is None:
        return None
    value = str(value).strip()
    return value or None


def area(attributes: dict, geometry: str) -> dict:
    """Los atributos del servicio, con nombres propios de este proyecto y sin tocar los valores."""
    reported = attributes.get("rep_area")
    return {
        "siteId": attributes.get("site_id"),
        "parcelId": text(attributes.get("site_pid")),
        "siteType": text(attributes.get("site_type")),
        "name": text(attributes.get("name")),
        "nameEng": text(attributes.get("name_eng")),
        "designation": text(attributes.get("desig")),
        "designationEng": text(attributes.get("desig_eng")),
        "designationType": text(attributes.get("desig_type")),
        "iucn": text(attributes.get("iucn_cat")),
        "realm": text(attributes.get("realm")),
        "status": text(attributes.get("status")),
        "statusYear": attributes.get("status_yr") or None,
        "governance": text(attributes.get("gov_type")),
        "authority": text(attributes.get("mang_auth")),
        "iso3": text(attributes.get("iso3")),
        "verification": text(attributes.get("verif")),
        "reportedAreaKm2": None if reported is None else round(float(reported), 2),
        "geometry": geometry,
    }


def unique(areas: list[dict]) -> list[dict]:
    """Un área puede venir en varias parcelas: se deja una fila por área y categoría."""
    seen, result = set(), []
    for item in areas:
        key = (item["siteId"], item["iucn"], item["designation"])
        if key not in seen:
            seen.add(key)
            result.append(item)
    return sorted(result, key=lambda item: (item["designationType"] != "National", item["name"] or ""))


def box(latitude: float, longitude: float) -> str:
    """Recuadro de BOX_KM de lado centrado en el lugar, como «oeste,sur,este,norte»."""
    half = BOX_KM * 500
    dlat = math.degrees(half / EARTH_RADIUS_M)
    dlon = dlat / max(math.cos(math.radians(latitude)), 0.01)
    return f"{longitude - dlon:.6f},{max(-90.0, latitude - dlat):.6f},{longitude + dlon:.6f},{min(90.0, latitude + dlat):.6f}"


def survey(place: dict) -> dict:
    latitude, longitude = place["latitude"], place["longitude"]
    at_point = unique([area(a, "poligono") for a in query(POLYGONS_LAYER, f"{longitude},{latitude}", "esriGeometryPoint")])
    inside = {(item["siteId"], item["iucn"], item["designation"]) for item in at_point}
    envelope = box(latitude, longitude)
    around = [area(a, "poligono") for a in query(POLYGONS_LAYER, envelope, "esriGeometryEnvelope")]
    around += [area(a, "punto") for a in query(POINTS_LAYER, envelope, "esriGeometryEnvelope")]
    nearby = [item for item in unique(around) if (item["siteId"], item["iucn"], item["designation"]) not in inside]
    return {"atPoint": at_point, "nearby": nearby}


def source() -> dict:
    """La cita la da el propio servicio; de ella sale el mes de la versión."""
    layer = get(f"{SERVICE}/{POLYGONS_LAYER}", {"f": "json"})
    citation = (layer.get("copyrightText") or "").strip()
    release = re.search(r"\[On-line\],\s*\[([^\]]+)\]", citation)
    return {
        "name": "World Database on Protected and Conserved Areas (WDPCA), UNEP-WCMC y UICN",
        "url": "https://www.protectedplanet.net/",
        "service": SERVICE,
        "terms": "https://www.protectedplanet.net/en/legal",
        "citation": citation,
        "release": release.group(1) if release else None,
        "boxKm": BOX_KM,
    }


def save(info: dict, places: list[dict], sites: dict, failed: list, backend: pathlib.Path) -> None:
    info = {**info, "fetched": datetime.date.today().isoformat()}
    OUT.write_text(json.dumps({"source": info, "sites": sites, "failed": failed}, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    data = backend / "data"
    if not data.is_dir():
        return
    catalog = [
        {
            "id": place["id"],
            "name": place["name"],
            "province": place["province"],
            "country": place["country"],
            "latitude": place["latitude"],
            "longitude": place["longitude"],
            # None: el lugar aún no se pudo consultar; el servidor no deja reservarlo.
            "protected": sites[place["id"]]["atPoint"] if place["id"] in sites else None,
            "nearby": sites[place["id"]]["nearby"] if place["id"] in sites else [],
        }
        for place in places
    ]
    (data / "lugares.json").write_text(json.dumps({"source": info, "places": catalog}, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")


def main() -> None:
    arguments = sys.argv[1:]
    backend = DEFAULT_BACKEND
    if "--backend" in arguments:
        backend = pathlib.Path(arguments[arguments.index("--backend") + 1])
    places = json.loads(PLACES.read_text(encoding="utf-8"))
    previous = {}
    if OUT.exists() and "--todo" not in arguments:
        previous = json.loads(OUT.read_text(encoding="utf-8")).get("sites", {})
    sites = {place["id"]: previous[place["id"]] for place in places if place["id"] in previous}
    pending = [place for place in places if place["id"] not in sites]
    print(f"{len(sites)} lugares ya consultados, faltan {len(pending)}", flush=True)
    info = source()
    print(f"Versión de la base: {info['release']}", flush=True)
    failed = []
    for place in pending:
        try:
            sites[place["id"]] = survey(place)
            found = sites[place["id"]]
            names = "; ".join(f"{item['name']} ({item['designationEng']}, UICN {item['iucn']})" for item in found["atPoint"])
            print(f"{place['name']}: {names or 'sin área protegida en el punto'} · {len(found['nearby'])} cercanas", flush=True)
        except (OSError, ValueError, KeyError) as error:
            failed.append(place["id"])
            print(f"{place['name']}: no se pudo consultar ({error})", flush=True)
        save(info, places, sites, failed, backend)
    save(info, places, sites, failed, backend)
    if not (backend / "data").is_dir():
        print(f"No se encontró {backend / 'data'}: el catálogo del servidor no se escribió.", flush=True)
    inside = sum(1 for value in sites.values() if value["atPoint"])
    print(
        f"Escrito {OUT.relative_to(ROOT)}: {inside} lugares dentro de un área protegida, "
        f"{len(sites) - inside} sin área en el punto, {len(failed)} sin consultar ({', '.join(failed) or 'ninguno'})",
        flush=True,
    )


if __name__ == "__main__":
    main()
