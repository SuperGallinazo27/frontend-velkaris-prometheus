# Temperatura del suelo de cada lugar (MODIS)

`calcular.py` lee la temperatura de la superficie del suelo medida por satélite y guarda **`src/data/temperaturaSuelo.json`**: la media de día y de noche de cada trimestre en el recuadro de 18 km de cada lugar de `src/features/world/places.json`. La pestaña «Clima» de un lugar la muestra junto a la temperatura de la región lunar (`scripts/luna/temperatura.py`).

## Los datos

16 GeoTIFF exportados con Google Earth Engine, de cobertura mundial y 1 km por píxel:

| Archivo | Qué es |
| --- | --- |
| `MODIS_Day_T1` … `MODIS_Day_T4` | Temperatura del suelo de día (banda `LST_Day_1km`), en °C |
| `MODIS_Night_T1` … `MODIS_Night_T4` | Temperatura del suelo de noche (banda `LST_Night_1km`), en °C |

- `T1` a `T4` son los trimestres: enero a marzo, abril a junio, julio a septiembre y octubre a diciembre.
- Cada archivo viene partido en dos mitades: `…-0000000000.tif` (de 180° O a 29° E) y `…-0000023296.tif` (de 29° E a 180° E).
- Pesan unos 800 MB cada uno (12,8 GB en total) y **no se guardan en el repositorio**.
- **Los archivos no indican de qué años son ni si el satélite es Terra o Aqua.** La aplicación lo dice así. El producto de referencia es [MOD11A1](https://lpdaac.usgs.gov/products/mod11a1v061/).

Es la temperatura de la superficie, no la del aire: de día, el suelo desnudo se calienta bastante más que el aire que mide una estación a 2 m.

## Uso

```bash
# Con los .zip tal como se descargan de Google Drive (descomprime de a un archivo y lo borra):
python scripts/temperatura/calcular.py --zips RUTA/Descargas --tmp RUTA/carpeta-vacia

# Con los .tif ya descomprimidos:
python scripts/temperatura/calcular.py --dir RUTA/carpeta-con-tif
```

Necesita numpy y rasterio (`scripts/terreno/requirements.txt`). Con `--zips` hacen falta menos de 2 GB libres y tarda unos 10 minutos. Guarda el avance después de cada archivo: si se interrumpe, al repetirlo continúa donde quedó.

## Cómo se calcula

- De cada archivo se lee solo el recuadro de 18 km de cada lugar (el mismo que se analiza y se ve en el mapa) y se promedian sus píxeles con dato.
- Si menos del 20 % del recuadro tiene dato, el valor queda vacío: no se rellena.
- `coverage` guarda qué parte del recuadro tenía dato de día.

Resultados que sirven de comprobación:
- Los desiertos salen calientes de día y con mucho salto: Yungay (Atacama) pasa de 47 °C de día a 15 °C de noche en enero–marzo.
- El Ártico sale frío y sin salto en invierno: el cráter Haughton queda en −37 °C de día y de noche en enero–marzo.
- Las estaciones caen donde deben: el trimestre más caliente es julio–septiembre en el hemisferio norte y enero–marzo u octubre–diciembre en el sur.
