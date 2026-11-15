"""Aligera un .glb sin cambiar su forma: pasa a JPEG las imágenes PNG sin transparencia, junta las
imágenes repetidas, guarda las normales en 8 bits y las coordenadas de textura en 16 bits
(extensión estándar KHR_mesh_quantization) y quita las coordenadas de textura que ningún material usa.

Las posiciones y los índices no se tocan: la geometría es la misma, al vértice.

Las imágenes se reducen a 768 px (color) y 512 px (resto): a la distancia de la cámara no se nota.

Uso: python -I aligerar.py entrada.glb salida.glb
"""
import hashlib
import io
import json
import struct
import sys

import numpy as np
from PIL import Image

COMPONENT = {5120: ("i1", 1), 5121: ("u1", 1), 5122: ("<i2", 2), 5123: ("<u2", 2), 5125: ("<u4", 4), 5126: ("<f4", 4)}
COUNT = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}
JPEG_QUALITY = 86
#: Lado máximo de las imágenes: las de color y las demás (normales, rugosidad).
COLOR_PX = 768
OTHER_PX = 512

source, target = sys.argv[1], sys.argv[2]
data = open(source, "rb").read()
assert data[:4] == b"glTF", "no es un .glb"
json_length = struct.unpack_from("<I", data, 12)[0]
gltf = json.loads(data[20 : 20 + json_length])
binary = data[20 + json_length + 8 :]
assert len(gltf["buffers"]) == 1, "se esperaba un solo búfer"


def view_bytes(index: int) -> bytes:
    view = gltf["bufferViews"][index]
    start = view.get("byteOffset", 0)
    return binary[start : start + view["byteLength"]]


def accessor_array(accessor: dict) -> np.ndarray:
    assert "sparse" not in accessor, "accesor disperso: no previsto"
    view = gltf["bufferViews"][accessor["bufferView"]]
    assert not view.get("byteStride"), "vista intercalada: no prevista"
    dtype, size = COMPONENT[accessor["componentType"]]
    count = COUNT[accessor["type"]]
    start = view.get("byteOffset", 0) + accessor.get("byteOffset", 0)
    flat = np.frombuffer(binary, dtype=dtype, count=accessor["count"] * count, offset=start)
    return flat.reshape(accessor["count"], count)


# ---------- Qué conjunto de coordenadas de textura usa cada material
def used_sets(material: dict) -> set[int]:
    found = set()

    def visit(node):
        if isinstance(node, dict):
            if "index" in node and ("texCoord" in node or set(node) <= {"index", "texCoord", "scale", "strength", "extensions"}):
                found.add(node.get("texCoord", 0))
            for value in node.values():
                visit(value)
        elif isinstance(node, list):
            for value in node:
                visit(value)

    visit(material)
    return found or {0}


removed_sets = 0
roles: dict[int, set[str]] = {}
for mesh in gltf["meshes"]:
    for primitive in mesh["primitives"]:
        assert "targets" not in primitive, "morph targets: no previstos"
        material = gltf["materials"][primitive["material"]] if "material" in primitive else {}
        keep = used_sets(material)
        for name in list(primitive["attributes"]):
            if name.startswith("TEXCOORD_") and int(name.split("_")[1]) not in keep:
                del primitive["attributes"][name]
                removed_sets += 1
        for name, accessor in primitive["attributes"].items():
            roles.setdefault(accessor, set()).add(name.split("_")[0] if name.startswith("TEXCOORD") else name)
        if "indices" in primitive:
            roles.setdefault(primitive["indices"], set()).add("indices")

# ---------- Búfer nuevo
chunks: list[bytes] = []
views: list[dict] = []
offset = 0


def add_view(payload: bytes, **extra) -> int:
    global offset
    padding = (-offset) % 4
    if padding:
        chunks.append(b"\0" * padding)
        offset += padding
    views.append({"buffer": 0, "byteOffset": offset, "byteLength": len(payload), **extra})
    chunks.append(payload)
    offset += len(payload)
    return len(views) - 1


quantized = {"NORMAL": 0, "TEXCOORD": 0}
for index, accessor in enumerate(gltf["accessors"]):
    role = roles.get(index, set())
    if not role:
        # Accesor que ya nadie usa (coordenadas de textura quitadas): queda vacío y mínimo.
        accessor.update({"bufferView": add_view(b"\0\0\0\0"), "byteOffset": 0, "count": 1, "componentType": 5121, "type": "SCALAR"})
        accessor.pop("min", None)
        accessor.pop("max", None)
        continue
    values = accessor_array(accessor)
    is_float = accessor["componentType"] == 5126
    if role == {"NORMAL"} and is_float:
        packed = np.zeros((len(values), 4), dtype="i1")
        packed[:, :3] = np.clip(np.rint(values * 127), -127, 127).astype("i1")
        accessor.update({"bufferView": add_view(packed.tobytes(), byteStride=4, target=34962), "byteOffset": 0, "componentType": 5120, "normalized": True})
        accessor.pop("min", None)
        accessor.pop("max", None)
        quantized["NORMAL"] += 1
    elif role == {"TEXCOORD"} and is_float and values.min() >= 0 and values.max() <= 1:
        packed = np.rint(values * 65535).astype("<u2")
        accessor.update({"bufferView": add_view(packed.tobytes(), byteStride=4, target=34962), "byteOffset": 0, "componentType": 5123, "normalized": True})
        accessor.pop("min", None)
        accessor.pop("max", None)
        quantized["TEXCOORD"] += 1
    else:
        extra = {"target": 34963} if role == {"indices"} else {"target": 34962}
        accessor.update({"bufferView": add_view(values.tobytes(), **extra), "byteOffset": 0})

# ---------- Imágenes
color_images: set[int] = set()
for material in gltf.get("materials", []):
    for info in (material.get("pbrMetallicRoughness", {}).get("baseColorTexture"), material.get("emissiveTexture")):
        if info:
            color_images.add(gltf["textures"][info["index"]].get("source"))
converted = 0
resized = 0
unique: dict[str, int] = {}
remap: dict[int, int] = {}
images: list[dict] = []
for index, image in enumerate(gltf.get("images", [])):
    payload = view_bytes(image["bufferView"])
    mime = image.get("mimeType", "")
    picture = Image.open(io.BytesIO(payload))
    picture.load()
    limit = COLOR_PX if index in color_images else OTHER_PX
    shrink = max(picture.size) > limit
    if shrink:
        scale = limit / max(picture.size)
        picture = picture.resize((round(picture.width * scale), round(picture.height * scale)), Image.Resampling.LANCZOS)
        resized += 1
    has_alpha = picture.mode in ("RGBA", "LA", "PA") or "transparency" in picture.info
    opaque = not has_alpha or picture.convert("RGBA").getchannel("A").getextrema()[0] == 255
    if opaque and (mime == "image/png" or shrink):
        out = io.BytesIO()
        picture.convert("RGB").save(out, "JPEG", quality=JPEG_QUALITY, optimize=True)
        if out.tell() < len(payload) or shrink:
            converted += mime == "image/png"
            payload, mime = out.getvalue(), "image/jpeg"
    elif shrink:
        out = io.BytesIO()
        picture.save(out, "PNG", optimize=True)
        payload = out.getvalue()
    digest = hashlib.sha256(payload).hexdigest()
    if digest in unique:
        remap[index] = unique[digest]
        continue
    unique[digest] = len(images)
    remap[index] = len(images)
    entry = {k: v for k, v in image.items() if k not in ("bufferView", "mimeType", "uri")}
    entry.update({"bufferView": add_view(payload), "mimeType": mime})
    images.append(entry)
if "images" in gltf:
    gltf["images"] = images
    for texture in gltf.get("textures", []):
        if "source" in texture:
            texture["source"] = remap[texture["source"]]

gltf["bufferViews"] = views
padding = (-offset) % 4
if padding:
    chunks.append(b"\0" * padding)
    offset += padding
gltf["buffers"] = [{"byteLength": offset}]
if quantized["NORMAL"] or quantized["TEXCOORD"]:
    for key in ("extensionsUsed", "extensionsRequired"):
        gltf[key] = sorted(set(gltf.get(key, [])) | {"KHR_mesh_quantization"})
gltf.setdefault("asset", {})["extras"] = {
    "nota": "Copia aligerada del modelo oficial de NASA/JPL-Caltech para PROMETHEUS: misma geometría; "
    "normales en 8 bits, coordenadas de textura en 16 bits, imágenes PNG opacas pasadas a JPEG y texturas reducidas "
    f"a {COLOR_PX} px (color) y {OTHER_PX} px (resto).",
}

text = json.dumps(gltf, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
text += b" " * ((-len(text)) % 4)
body = b"".join(chunks)
total = 12 + 8 + len(text) + 8 + len(body)
with open(target, "wb") as handle:
    handle.write(struct.pack("<4sII", b"glTF", 2, total))
    handle.write(struct.pack("<I4s", len(text), b"JSON"))
    handle.write(text)
    handle.write(struct.pack("<I4s", len(body), b"BIN\0"))
    handle.write(body)
print(
    f"{source}: {len(data) / 1e6:.2f} MB → {total / 1e6:.2f} MB · normales {quantized['NORMAL']} · coordenadas {quantized['TEXCOORD']} · "
    f"conjuntos de coordenadas quitados {removed_sets} · PNG→JPEG {converted} · reducidas {resized} · imágenes {len(gltf.get('images', []))} de {len(remap)}"
)
