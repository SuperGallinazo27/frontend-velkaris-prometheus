"""Texturas de detalle del suelo y de las rocas del simulador, de Poly Haven (licencia CC0).

Descarga el color y el relieve fino (mapa de normales) de cada material a 1024 px, los reduce a
512 px en JPEG y los deja en public/texturas/. También imprime el color medio de cada textura (en
espacio lineal): el simulador lo usa para que la textura solo añada variación, sin cambiar el color
del suelo, que sigue saliendo de la imagen de satélite.

Uso:  python -I scripts/modelos/texturas.py
Necesita pillow y numpy (scripts/terreno/requirements.txt) e internet.
"""

import io
import json
import pathlib
import urllib.request

import numpy as np
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / "public" / "texturas"
API = "https://api.polyhaven.com/files/"
SIZE = 512

#: Superficie del simulador → textura de Poly Haven.
TEXTURES = {
    "arena": "sandy_gravel_02",
    "grava": "rocks_ground_01",
    "ceniza": "rock_ground",
    "lava": "dark_rock",
    "roca": "rock_08",
    "suelo": "dry_ground_rocks",
    "sal": "dry_ground_01",
    "nieve": "snow_02",
    "vegetacion": "grass_ground",
    "bloque": "rock_boulder_dry",
}


def fetch(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": "prometheus-simulador/1.0"})
    with urllib.request.urlopen(request, timeout=120) as response:
        return response.read()


def linear(srgb: np.ndarray) -> np.ndarray:
    return np.where(srgb <= 0.04045, srgb / 12.92, ((srgb + 0.055) / 1.055) ** 2.4)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    table = {}
    for name, asset in TEXTURES.items():
        files = json.loads(fetch(API + asset))
        info = json.loads(fetch(f"https://api.polyhaven.com/info/{asset}"))
        color = Image.open(io.BytesIO(fetch(files["Diffuse"]["1k"]["jpg"]["url"]))).convert("RGB")
        normal = Image.open(io.BytesIO(fetch(files["nor_gl"]["1k"]["jpg"]["url"]))).convert("RGB")
        color = color.resize((SIZE, SIZE), Image.Resampling.LANCZOS)
        normal = normal.resize((SIZE, SIZE), Image.Resampling.LANCZOS)
        color.save(OUT / f"{name}-color.jpg", "JPEG", quality=82, optimize=True)
        normal.save(OUT / f"{name}-normal.jpg", "JPEG", quality=86, optimize=True)
        mean = linear(np.asarray(color, dtype=np.float64) / 255).reshape(-1, 3).mean(axis=0)
        table[name] = {
            "asset": asset,
            "tileM": round(info["dimensions"][0] / 1000, 2),
            "mean": [round(float(v), 4) for v in mean],
            "authors": sorted(info.get("authors", {}).keys()),
        }
        weight = ((OUT / f"{name}-color.jpg").stat().st_size + (OUT / f"{name}-normal.jpg").stat().st_size) // 1024
        print(f"{name}: {asset} · {table[name]['tileM']} m · media {table[name]['mean']} · {weight} KB · {', '.join(table[name]['authors'])}")
    print(json.dumps(table, ensure_ascii=False))
    total = sum(f.stat().st_size for f in OUT.glob("*.jpg")) // 1024
    print(f"Total: {total} KB en {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
