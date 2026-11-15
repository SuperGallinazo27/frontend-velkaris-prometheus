# Cálculo del terreno real

Genera los datos con los que el mundo interactivo compara la Luna con la Tierra. La aplicación no necesita Python para funcionar: solo hay que ejecutar esto cuando cambie la lista de lugares o las regiones lunares.

## Qué hace

1. Lee las regiones lunares de `regiones_luna.json`: las nueve candidatas de Artemis III en el polo sur y, en el polo norte y la zona central, recuadros de 21 km alrededor de accidentes con nombre.
2. Lee por internet solo los recuadros necesarios de la elevación lunar y terrestre. De los archivos grandes no descarga más que esos tramos.
3. Calcula relieve, pendiente y rugosidad con la misma receta en ambos cuerpos (`descriptores.py`).
4. Escribe `src/data/terrenoReal.json` y los tres mapas lunares de `src/features/world/`.

| | Fuente | Archivo |
| --- | --- | --- |
| Luna, polo sur | [NASA GSFC PGDA, producto 90](https://pgda.gsfc.nasa.gov/products/90) | `LDEM_75S_30MPP_ADJ.TIF` (elevación), `LDSM_…` (pendiente, para contrastar) y `LDEC_…` (mediciones por píxel) |
| Luna, polo norte | [NASA PDS, LOLA GDR](https://pds-geosciences.wustl.edu/missions/lro/lola.htm) | `lola_gdr/polar/img/ldem_75n_30m.img`, 30 m por píxel |
| Luna, zona central | [NASA PDS, SLDEM2015](https://pds-geosciences.wustl.edu/missions/lro/lola.htm) | Teselas `sldem2015/tiles/float_img/`, 512 píxeles por grado (unos 59 m) |
| Mapas del selector | Los mismos productos, en sus versiones reducidas | `ldem_75n_240m.img` y `ldem_16.img` |
| Tierra | [Copernicus DEM en AWS](https://registry.opendata.aws/copernicus-dem/) | Recuadros GLO-30 de 1° × 1° y su máscara de agua (`WBM`); GLO-90 si no existe el de 30 m |
| Lugares | `src/features/world/places.json` | — |

## Cómo ejecutarlo

Necesita Python 3.11 o posterior e internet. La primera vez tarda unos 10 minutos y lee alrededor de 500 MB; con `--cache`, las siguientes son inmediatas.

```bash
python -m venv .venv-terreno
.venv-terreno/Scripts/pip install -r scripts/terreno/requirements.txt   # en macOS o Linux: .venv-terreno/bin/pip
.venv-terreno/Scripts/python scripts/terreno/calcular.py --cache .cache-terreno
```

- `--cache CARPETA` guarda lo leído por internet, para que repetir el cálculo sea inmediato.
- `--solo luna` o `--solo tierra` recalcula solo una parte.

Después, `bun test` comprueba que el resultado cubre la lista de lugares y que la pendiente lunar calculada coincide con la que publica la NASA.

Pruebas del cálculo:

```bash
cd scripts/terreno && python -m unittest test_descriptores
```

## Añadir un lugar

1. Añade una fila en `src/features/world/places.json` con un `id` único, la jerarquía y las coordenadas. El campo `demo` son valores sintéticos para la demostración de Marte.
2. Ejecuta el cálculo.
3. Ejecuta `bun test`.

## La receta

- Malla métrica de 30 m en los polos. En la Luna es la malla original del producto (estereográfica polar, con la corrección de escala de la latitud). En la Tierra, una proyección acimutal equivalente centrada en el lugar, con remuestreo bilineal.
- Malla métrica de 60 m en la zona central, porque SLDEM2015 tiene unos 59 m por píxel. En la Luna se remuestrea a una proyección acimutal local; en la Tierra se promedian bloques de 2 × 2 píxeles de la malla de 30 m. Así las dos partes de cada comparación tienen la misma resolución (`zonas.py`).
- Ventanas de 3 km × 3 km (100 × 100 píxeles a 30 m, 50 × 50 a 60 m). Por ventana:
  - **Relieve:** elevación máxima menos mínima.
  - **Pendiente:** media de la pendiente local, con diferencias centrales de los 4 vecinos.
  - **Rugosidad:** RMS de los residuos respecto a un plano ajustado por mínimos cuadrados.
- Una ventana con menos del 90 % de píxeles válidos se descarta. En la Tierra, el agua (mar, lagos y ríos según la máscara de Copernicus) no es válida.
- Cada región lunar se resume con la mediana de las ventanas que caben en su recuadro. Cada lugar terrestre, con la mediana de 6 × 6 ventanas (18 km) centradas en su coordenada.
- Con menos de 9 ventanas válidas, el lugar queda sin datos. No se rellena con ceros.

Es la definición `prometheus_topography_plane_v1` del backend aplicada por ventana, pero no el mismo código ni el mismo modelo terrestre: el backend usa NASADEM desde Google Earth Engine y proyección UTM.

## Las regiones lunares

**Polo norte y zona central.** No hay regiones candidatas publicadas, así que cada región es un recuadro de 21 km centrado en el centro de un accidente con nombre, con las coordenadas del [nomenclátor IAU/USGS](https://planetarynames.wr.usgs.gov/GIS_Downloads). En un cráter, eso es su fondo. Los archivos del PDS no están comprimidos, de modo que cada recuadro se lee pidiendo solo el tramo de bytes de sus filas; la lectura se comprobó contra el lector de GDAL.

**Polo sur.** La NASA publicó el [mapa](https://www.nasa.gov/wp-content/uploads/2024/10/artemis-iii-landing-region-candidates.jpg) de las nueve regiones, pero no sus coordenadas. `regiones_luna.json` guarda cada recuadro en píxeles de ese mapa y los tres datos que lo convierten a la proyección: la posición de la estrella del polo, la escala de la barra de 50 km y la orientación. La conversión se comprobó dibujando sobre el mapa los cráteres del [nomenclátor IAU/USGS](https://planetarynames.wr.usgs.gov/GIS_Downloads): Shackleton, Shoemaker, Faustini, Haworth, Nobile y los demás caen en su sitio. El error estimado es del orden de 1 km, así que son ubicaciones aproximadas y no límites oficiales.

## Límites

- Compara solo la forma del terreno a escala de 30 m a 3 km. No dice nada de rocas, regolito, mineralogía, temperatura ni iluminación.
- Parte de la elevación lunar es interpolada entre pasadas de LOLA, lo que suaviza la pendiente a 30 m. El campo `measured` de cada región dice qué fracción de píxeles tiene medición directa.
- Copernicus DEM es un modelo de superficie (incluye vegetación y edificios) y tiene ruido en zonas muy planas.
- Las coordenadas de los lugares son aproximadas: describen un área de 18 km, no un sitio de ensayo concreto.

## Atribución

- LOLA: Barker, M. K. et al. (2023), *Planetary Science Journal* 4, 183, [doi:10.3847/PSJ/acf3e1](https://doi.org/10.3847/PSJ/acf3e1).
- Copernicus DEM: © DLR e.V. 2010-2014 y © Airbus Defence and Space GmbH 2014-2018, provisto bajo COPERNICUS por la Unión Europea y la ESA; todos los derechos reservados.
