# Clima típico de cada lugar

Descarga los promedios mensuales con los que la ficha de un lugar muestra su **temporada**. La aplicación no necesita Python para funcionar: solo hay que ejecutar esto cuando cambie la lista de lugares.

## Qué hace

Hace una consulta por lugar a la climatología de [NASA POWER](https://power.larc.nasa.gov/) (promedio de 2001 a 2025) y guarda `src/data/climaReal.json` con, para cada mes:

| Campo | Qué es | Unidad |
| --- | --- | --- |
| `temperature` | Temperatura media | °C |
| `range` | Diferencia típica entre la máxima y la mínima del día | °C |
| `precipitation` | Precipitación acumulada en el mes | mm |
| `wind` | Viento medio a 10 m | m/s |
| `cloud` | Cielo cubierto | % |

También guarda `cellElevation`, la altitud media de la celda del modelo.

## Cómo ejecutarlo

Solo necesita Python 3.10 o posterior e internet; no hay dependencias que instalar. Tarda menos de un minuto.

```bash
python scripts/clima/calcular.py
```

Después, `bun test` comprueba que el resultado cubre la lista de lugares.

## Cómo se usa en la pantalla

La lógica está en `src/features/world/climate.ts`, con pruebas en `tests/season.test.ts`:

- **Temperatura ajustada a la altitud.** El dato es de una celda de unos 50 km. La temperatura se corrige con el gradiente térmico estándar (6,5 °C por cada kilómetro) entre la altitud de la celda y la del lugar, que sale del modelo de elevación. La máxima y la mínima típicas del día son la media más y menos la mitad de `range`.
- **Horas de luz.** Se calculan con la latitud y la fecha; no vienen de la fuente.
- **Valoración de cada mes para trabajo de campo.** Es un criterio de PROMETHEUS, no un requisito oficial:

  | | Inconveniente moderado | Extremo |
  | --- | --- | --- |
  | Precipitación | 30 mm o más al mes | más de 100 mm |
  | Frío (mínima típica) | menos de −5 °C | menos de −15 °C |
  | Calor (máxima típica) | más de 32 °C | más de 38 °C |
  | Viento medio | 25 km/h o más | más de 35 km/h |
  | Luz | menos de 8 h | menos de 4 h |

  Un mes es **difícil** con algún extremo o con tres o más inconvenientes moderados a la vez, **aceptable** con uno o dos inconvenientes moderados y **favorable** sin ninguno. La «mejor época» es la racha más larga de meses seguidos con la mejor valoración que tenga el lugar.

## Límites

- **La celda es grande.** En montañas e islas, la lluvia y el viento del sitio pueden ser muy distintos de los de la celda. Mauna Loa es el ejemplo claro: la celda incluye la ladera lluviosa de Hilo y el resultado sale más húmedo que la cumbre. La pantalla avisa cuando la celda queda 800 m o más por encima o por debajo del lugar.
- **El ajuste de altitud es una aproximación** y solo corrige la temperatura.
- **Es clima típico, no pronóstico.** El estado actual del lugar se consulta aparte, en vivo, con Open-Meteo.
- **La mejor época para ir no es siempre la mejor para el ensayo.** Si una prueba necesita frío o poca luz, hay que leer los datos del mes, no la valoración.

## El Niño y La Niña

`enso.py` guarda en **`src/data/enso.json`** una copia con fecha de dos índices del Climate Prediction Center de NOAA: el ONI (anomalía de la temperatura del mar en el Pacífico ecuatorial central, en promedios de tres meses) y la temperatura semanal del mar en las regiones Niño, incluida la Niño 1+2, frente a Ecuador y Perú.

```bash
python scripts/clima/enso.py
```

- Con servidor, la aplicación pide el dato en vivo a `/api/v1/climate/enso` (NOAA no permite leer sus tablas desde el navegador). Sin servidor, o si falla, usa esta copia, y la pantalla muestra siempre la fecha del dato.
- Conviene repetirlo antes de una presentación: NOAA actualiza el ONI una vez al mes.
- Va junto a la **lluvia real de los últimos 30 días** (Open-Meteo, en vivo desde el navegador): entre los dos corrigen el recuadro «Ahora» de la pestaña «Clima», que antes mostraba solo el promedio de muchos años. Un año con El Niño puede traer lluvias fuertes en plena «temporada seca», como en Galápagos en noviembre de 2026.
