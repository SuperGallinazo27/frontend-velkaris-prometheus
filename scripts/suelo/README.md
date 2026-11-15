# Suelo sugerido de cada lugar

`calcular.py` consulta el mapa mundial de suelos **SoilGrids 2.0** (ISRIC) para los lugares de `src/features/world/places.json` y escribe `src/data/sueloReal.json`. Para cada lugar guarda la textura de los primeros 5 cm: arena, limo y arcilla en %, y la densidad aparente en g/cm³.

```bash
python scripts/suelo/calcular.py          # consulta solo los lugares que faltan
python scripts/suelo/calcular.py --todo   # vuelve a consultar todos
```

Solo usa la biblioteca estándar de Python.

## El servicio

El servicio está en fase beta. Admite 5 consultas por minuto y a veces tarda casi un minuto en responder. Por eso el script:

- espera entre consultas;
- guarda cada lugar en cuanto llega;
- anota en `failed` los lugares que no pudo consultar y sigue con el resto.

Si quedan lugares en `failed`, vuelve a ejecutarlo: solo pedirá esos.

## Cómo se usa en la pestaña «Ruedas»

La textura elige el suelo sugerido con una regla simple (`suggestSoil` en `src/features/mission/wheelData.ts`):

| Textura | Suelo sugerido |
| --- | --- |
| 70 % de arena o más | arena seca |
| 35 % de arcilla o más | suelo arcilloso |
| el resto | franco arenoso |

La pantalla dice siempre de dónde sale la sugerencia, y el suelo se puede cambiar. Si el lugar se consultó pero el mapa no tiene dato ahí, lo dice así. Si el lugar aún no se consultó, también.

## Límites

- **Es una predicción**, no una medición. El mapa sale de un modelo entrenado con perfiles de suelo y falla en terrenos volcánicos jóvenes y desnudos: en la cumbre del Mauna Kea, que es tefra, predice un 23 % de arcilla.
- No da datos sobre glaciares, roca desnuda ni agua (devuelve vacío).
- Licencia **CC BY 4.0**. Cita: Poggio y otros (2021), *SOIL* 7, 217-240, https://doi.org/10.5194/soil-7-217-2021.
