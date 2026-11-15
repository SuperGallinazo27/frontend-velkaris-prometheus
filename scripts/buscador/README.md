# Búsqueda amplia: zonas nuevas parecidas a la Luna

`calcular.py` recorre el relieve de la Tierra y busca, **fuera de los lugares de la lista**, las zonas áridas cuyo terreno se parece más a cada región lunar. Guarda **`src/data/candidatosGlobales.json`**, que la tarjeta de la región lunar muestra como «Más allá de la lista: zonas nuevas por explorar».

Son puntos de partida para explorar, no lugares listos para una campaña: solo se compara la forma del terreno a escala gruesa. La pantalla lo dice.

## Los datos

| Dato | Fuente | Resolución |
| --- | --- | --- |
| Relieve de la Tierra | [ETOPO 2022](https://www.ncei.noaa.gov/products/etopo-global-relief-model) de NOAA NCEI (doi:10.25921/fd45-gt74), teselas `ETOPO_2022_v1_15s_N30W045_surface.tif` de 15° × 15° | 15 segundos de arco, unos 463 m |
| Relieve de la Luna | `LDEM_64_FLOAT.IMG` de LOLA (el mismo de `scripts/luna/calcular.py`) | 64 píxeles por grado, unos 474 m |
| Lluvia anual | [WorldClim 2.1](https://www.worldclim.org/data/worldclim21.html) (Fick y Hijmans, 2017); se descarga sola, 7 MB | 10 minutos de arco |
| Nombres | Nominatim, © colaboradores de OpenStreetMap; una consulta por zona y por segundo | — |

- Las teselas de ETOPO pesan unos 2 GB en total y **no se guardan en el repositorio**. El script las lee de los `.zip` de Google Drive sin descomprimirlos en disco, o de una carpeta con `--etopo-dir`.
- **Cobertura:** solo las teselas que se tengan. Con las descargadas en noviembre de 2026 son 77, de 15° S a 45° N (y de 30° a 45° N solo entre 0° y 75° E). Lo que quede fuera, como Atacama o Australia, no entra en la búsqueda. El resultado guarda la cobertura y la pantalla la muestra.
- WorldClim es de uso libre no comercial; aquí solo se usa para filtrar y no se redistribuye.

## Uso

```bash
python scripts/buscador/calcular.py --zips RUTA/Descargas --ldem RUTA/LDEM_64_FLOAT.IMG --tmp RUTA/carpeta
```

Necesita numpy y rasterio (`scripts/terreno/requirements.txt`) e internet. Tarda unos 8 minutos. En `--tmp` guarda los bloques ya calculados, la lluvia y los nombres consultados: si se interrumpe, al repetirlo no vuelve a empezar.

## Cómo se calcula

1. **Misma escala en los dos mundos.** La Luna se remuestrea al paso de ETOPO (cerca de los polos, en un plano centrado en el polo, porque los meridianos convergen).
2. **Misma receta que la aplicación**, llevada a esta escala: ventanas de 7 × 7 píxeles (unos 3,2 km) con relieve = máximo − mínimo, pendiente = media de la pendiente local y rugosidad = RMS respecto a un plano. Cada bloque de 5 × 5 ventanas (unos 16 km) se resume con la mediana.
3. **Solo tierra firme.** Una ventana con mar no cuenta. Tampoco una totalmente plana (menos de 1 m de relieve): el modelo no distingue un lago de un salar.
4. **Solo zonas áridas:** menos de 250 mm de lluvia al año. Ahí el suelo suele estar desnudo, como hace falta para probar un robot. Es un filtro simple: no sustituye a un mapa de vegetación.
5. **Lejos de la lista:** a más de 60 km de cualquier lugar de `places.json`.
6. **Las 5 más parecidas** a cada región lunar, con la distancia de terreno de la aplicación y a más de 150 km unas de otras.

## Límites que hay que tener presentes

- A 470 m no se ven cráteres pequeños, dunas ni rocas. Al medir una zona a 30 m, como los lugares de la lista, su coincidencia puede bajar.
- No se comprobó el acceso, el clima de ahora, el suelo ni si la zona es un área protegida.
- Los valles por debajo del nivel del mar (Dallol, el mar Muerto) quedan fuera, porque el relieve negativo se toma como mar.
