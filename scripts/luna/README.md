# Relieve y rugosidad de la Luna (LOLA)

`calcular.py` toma dos productos del láser LOLA de la sonda LRO de NASA y genera:

- **`src/features/landing/luna-lola.webp`**: el relieve sombreado de toda la Luna, la textura de la Luna de la portada. Es equirrectangular, va de −180° a 180° de longitud, tiene el norte arriba y mide 2048 × 1024 píxeles. **Es relieve, no una fotografía**: el tono sale de la altura y de la luz, no del brillo real del suelo.
- **`src/data/rugosidadLola.json`**: la rugosidad fina de cada región lunar de `terrenoReal.json` y la de toda la Luna como referencia. Se muestra en el panel de cada región.

## Los datos

Vienen del PDS Geosciences Node, conjunto `LRO-L-LOLA-4-GDR-V1.0`, proyección cilíndrica en coma flotante:
https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/cylindrical/float_img/

| Archivo | Qué es | Resolución | Peso |
| --- | --- | --- | --- |
| `ldem_64_float.img` (+ `.lbl`) | Elevación, en km sobre una esfera de 1737,4 km | 64 píxeles por grado (unos 474 m) | 1 GB |
| `ldrm_32_50_float.img` (+ `.lbl`) | Rugosidad, mediana de cada píxel, en m | 32 píxeles por grado (unos 948 m) | 265 MB |

**Rugosidad fina:** es la variación de altura entre los 5 puntos de un mismo pulso del láser, separados unos 25 m. Por eso describe el terreno a una escala cercana a la de un robot.
- El ruido del instrumento es de unos 0,15 m.
- Donde no hubo medición, el producto rellena con valores vecinos, y en los mapas se ven rayas a lo largo de las órbitas.
- Los productos `ldrm_32_25` y `ldrm_32_75` son los cuantiles 0,25 y 0,75 de cada píxel; no se usan aquí.

Los datos de NASA son de dominio público. Crédito: *NASA LRO LOLA (PDS)*.

## Uso

Los archivos no se guardan en el repositorio: descárgalos de la dirección de arriba y pasa sus rutas.

```bash
python scripts/luna/calcular.py --ldem RUTA/ldem_64_float.img --ldrm RUTA/ldrm_32_50_float.img
```

Necesita numpy y pillow (`scripts/terreno/requirements.txt`). Tarda unos 15 segundos: lee los archivos por partes, sin cargarlos enteros en memoria.

## Cómo se calcula

- **Textura:**
  1. Promedia bloques de 9 × 9 píxeles del relieve.
  2. Sombrea con la luz desde el oeste-noroeste, a 35° de altura. Las pendientes se miden en kilómetros reales: hacia el este, la distancia entre columnas se acorta con el coseno de la latitud.
  3. Aclara un poco lo más alto.
- **Rugosidad de una región:**
  - Toma los píxeles dentro de un círculo con la misma área que el recuadro de la región, centrado en ella.
  - Da la mediana y los cuartiles de esos píxeles.
  - La de toda la Luna es la mediana con cada píxel pesado por su área (el coseno de la latitud): 0,41 m.

Resultados que sirven de comprobación:
- El Mar de la Tranquilidad, llanura de lava del Apolo 11, sale liso: 0,32 m.
- Aristarco, un cráter joven de bordes ásperos, sale el más rugoso: 0,87 m.

## Temperatura del suelo lunar (Diviner)

`temperatura.py` guarda **`src/data/temperaturaLuna.json`**: la temperatura más alta y la más baja del ciclo día-noche en cada región lunar. La pestaña «Clima» de un lugar la muestra junto a la temperatura del suelo de la Tierra (`scripts/temperatura/`).

- **Datos:** los «Global Cumulative Products» del radiómetro Diviner de LRO, en el PDS Geosciences Node: https://pds-geosciences.wustl.edu/lro/urn-nasa-pds-lro_diviner_derived1/data_derived_gcp/
- Son tablas de texto, una por franja de 10° de latitud (156 MB cada una), con la temperatura bolométrica de brillo en celdas de 0,5° y cada cuarto de hora de hora local, de julio de 2009 a abril de 2015. Referencia: Williams y otros (2017), *Icarus* 283, 300–325.
- El script las lee directamente de internet, sin guardarlas: solo las seis franjas que tocan alguna región (unos 940 MB). Con `--dir` usa tablas ya descargadas.

```bash
python scripts/luna/temperatura.py
```

Solo necesita Python 3. Tarda unos 15 minutos, casi todo en la descarga.

**Cómo se calcula:** de cada celda de 0,5° dentro de un círculo con la misma área que el recuadro de la región, la temperatura más alta y la más baja de todas las horas locales; de la región, la mediana de sus celdas. Solo cuentan las celdas con al menos la mitad de las horas locales observadas.

Resultados que sirven de comprobación:
- El Mar de la Tranquilidad va de 95 K (−178 °C) de noche a 396 K (122 °C) a mediodía, lo que publica el equipo de Diviner para el ecuador.
- En los polos, el suelo nunca pasa de unos 270 K: Haworth queda entre 51 y 222 K. Las celdas de 0,5° (15 km) promedian laderas iluminadas y fondos en sombra; el fondo de un cráter en sombra permanente es todavía más frío.
