"""Arma los datos del hangar a partir de la investigación verificada.

Entrada: `scripts/hangar/investigacion/datos-<robot>.json`. Cada dato trae la página de donde salió
y una cita textual de esa página (`quote`); ver el README de esta carpeta.

Salida:
- `src/data/hangar.json`: lo que muestra la aplicación, en español (sin las citas, que quedan aquí).
- `src/i18n/en.json`: se le añaden las traducciones al inglés de esos textos.

Uso, desde la raíz del frontend:  python scripts/hangar/armar.py
"""
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[2]
SOURCE = ROOT / "scripts" / "hangar" / "investigacion"
OUT = ROOT / "src" / "data" / "hangar.json"
DICTIONARY = ROOT / "src" / "i18n" / "en.json"

ROBOTS = ["perseverance", "curiosity", "viper", "lrv"]

# Nombres de misión tal como se muestran, y su versión en inglés cuando cambia.
MISSION_NAMES = {
    "Dragonfly": "Dragonfly (Titán)",
    "Apollo 15": "Apolo 15",
    "Apollo 16": "Apolo 16",
    "Apollo 17": "Apolo 17",
}
MISSION_ENGLISH = {
    "Dragonfly (Titán)": "Dragonfly (Titan)",
    "Mars Exploration Rovers (Spirit y Opportunity)": "Mars Exploration Rovers (Spirit and Opportunity)",
    "Apolo 15": "Apollo 15",
    "Apolo 16": "Apollo 16",
    "Apolo 17": "Apollo 17",
}
# El año de cada misión heredada es el de su lanzamiento. Una de las fichas traía el del aterrizaje
# de Spirit y Opportunity (2004); se lanzaron en 2003 (NSSDCA).
HERITAGE_YEARS = {"Mars Exploration Rovers (Spirit y Opportunity)": 2003}

# De los trece hitos de VIPER que se verificaron, los que cuentan su historia sin repetirse.
VIPER_MILESTONES = {"2020-06-11", "2021-09-20", "2024-06-04", "2024-07-17", "2024-11", "2025-09-19", "2026-10-20"}

english: dict[str, str] = {}
conflicts: list[str] = []


def pair(es: str, en: str) -> str:
    """Anota la traducción de un texto y devuelve el texto en español, limpio."""
    es, en = es.strip(), en.strip()
    if es and en and es != en:
        if es in english and english[es] != en:
            conflicts.append(f"{es!r}: {english[es]!r} / {en!r}")
        english.setdefault(es, en)
    return es


def source(ref: dict) -> dict:
    return {"title": ref["title"].strip(), "url": ref["url"].strip()}


def milestone(item: dict) -> dict:
    return {"date": item["date"], "text": pair(item["text_es"], item["text_en"]), "source": source(item["source"])}


def component(item: dict) -> dict:
    heritage = []
    for entry in item["heritage"]:
        name = MISSION_NAMES.get(entry["mission"].strip(), entry["mission"].strip())
        if name in MISSION_ENGLISH:
            pair(name, MISSION_ENGLISH[name])
        heritage.append({
            "mission": name,
            "year": HERITAGE_YEARS.get(name, entry["year"]),
            "note": pair(entry["note_es"], entry["note_en"]),
            "source": source(entry["source"]),
        })
    return {
        "name": pair(item["name_es"], item["name_en"]),
        "what": pair(item["what_es"], item["what_en"]),
        "facts": [
            {"label": pair(f["label_es"], f["label_en"]), "value": pair(f["value_es"], f["value_en"]), "source": source(f["source"])}
            for f in item["facts"]
        ],
        "heritage": sorted(heritage, key=lambda entry: entry["year"]),
    }


def mission(item: dict, keep: set[str] | None = None) -> dict:
    name = MISSION_NAMES.get(item["name"].strip(), item["name"].strip())
    if name in MISSION_ENGLISH:
        pair(name, MISSION_ENGLISH[name])
    milestones = [m for m in item["milestones"] if keep is None or m["date"] in keep]
    return {
        "name": name,
        "agency": item["agency"].strip(),
        "start": item["start"],
        "end": item["end"],
        "where": pair(item["where_es"], item["where_en"]),
        "summary": pair(item["summary_es"], item["summary_en"]),
        "milestones": [milestone(m) for m in milestones],
        "source": source(item["source"]),
    }


robots: dict[str, dict] = {}
checked = ""
for robot in ROBOTS:
    data = json.loads((SOURCE / f"datos-{robot}.json").read_text(encoding="utf-8"))
    checked = max(checked, data["checked"])
    robots[robot] = {
        "components": {key: component(value) for key, value in data["components"].items()},
        "missions": [mission(m, VIPER_MILESTONES if robot == "viper" else None) for m in data["missions"]],
    }
    # Los robots sin forma 3D (CADRE, DuAxel, EELS) solo tienen estado e hitos.
    for other, info in data.get("others", {}).items():
        robots[other] = {
            "components": {},
            "missions": [{
                "name": other.upper() if other != "duaxel" else "DuAxel",
                "agency": "NASA / JPL",
                "start": None,
                "end": None,
                "where": "",
                "summary": pair(info["status_es"], info["status_en"]),
                "milestones": [milestone(m) for m in info["milestones"]],
                "source": source(info["milestones"][0]["source"]),
            }],
        }

OUT.write_text(json.dumps({
    "description": "Componentes, herencia de vuelo e historial de misiones de los robots del hangar. Cada dato tiene su fuente; las citas textuales están en scripts/hangar/investigacion/.",
    "checked": checked,
    "robots": robots,
}, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")

dictionary = json.loads(DICTIONARY.read_text(encoding="utf-8"))
before = len(dictionary["exact"])
# Lo que el diccionario ya traducía no se toca: esas palabras se usan en otras pantallas.
kept = {es: en for es, en in english.items() if es in dictionary["exact"] and dictionary["exact"][es] != en}
for es, en in english.items():
    dictionary["exact"].setdefault(es, en)
# Textos de la interfaz del hangar y de los gestos: fijos y con valores («{0} misiones»).
interface = json.loads((ROOT / "scripts" / "hangar" / "interfaz.json").read_text(encoding="utf-8"))
for es, en in interface["exact"].items():
    if es in dictionary["exact"] and dictionary["exact"][es] != en:
        kept[es] = en
    dictionary["exact"].setdefault(es, en)
known_templates = {es for es, _ in dictionary["templates"]}
for es, en in interface["templates"]:
    if es not in known_templates:
        dictionary["templates"].append([es, en])
dictionary["templates"].sort(key=lambda item: item[0])
dictionary["exact"] = dict(sorted(dictionary["exact"].items(), key=lambda item: item[0]))
DICTIONARY.write_text(json.dumps(dictionary, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")

facts = sum(len(c["facts"]) for r in robots.values() for c in r["components"].values())
heritage = sum(len(c["heritage"]) for r in robots.values() for c in r["components"].values())
milestones = sum(len(m["milestones"]) for r in robots.values() for m in r["missions"])
print(f"robots: {len(robots)} | componentes: {sum(len(r['components']) for r in robots.values())} | datos: {facts} | herencia: {heritage} | hitos: {milestones}")
print(f"traducciones: {len(english)} de datos y {len(interface['exact'])} de interfaz (diccionario: {before} → {len(dictionary['exact'])})")
for line in conflicts:
    print("dos traducciones para un mismo texto (vale la primera):", line)
for es, en in kept.items():
    print(f"ya estaba en el diccionario: {es!r} = {dictionary['exact'][es]!r} (la investigación decía {en!r})")
