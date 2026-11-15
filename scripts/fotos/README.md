# Lectura del terreno a partir de fotos (IA)

`leer.py` le enseña a una IA que mira imágenes (Gemini) las fotos reales tomadas cerca de cada lugar y guarda lo que ve en **`src/data/lecturaTerreno.json`**. La aplicación lo muestra en la pestaña «Fotos» y el simulador lo usa para poner las rocas.

Llena un hueco de los datos: el relieve tiene un punto cada 30 m y **no ve rocas**. Una foto del suelo, sí.

## Qué hace

1. Busca en [Wikimedia Commons](https://commons.wikimedia.org/) las fotos con ubicación a menos de 10 km del lugar, con el mismo criterio que la pestaña «Fotos» (JPEG, con autor y licencia, sin series repetidas). Revisa hasta 16.
2. Envía sus miniaturas a Gemini y le pide, **foto por foto**:
   - si en ella se distingue el suelo natural del lugar (un retrato, un interior o una vista aérea no sirven);
   - si el suelo se ve **de cerca** (se pueden contar rocas) o **de lejos** (solo el tipo de superficie);
   - qué lo cubre, cuántas rocas sueltas hay, de qué tamaño, cuánta vegetación, y si se ve agua, barro o nieve.
3. Pide un resumen del lugar usando solo las fotos que sirven.
4. Guarda el resumen y **cada foto revisada con lo que la IA vio en ella**, como evidencia.

## Las clases

| Campo | Valores |
| --- | --- |
| Superficie | lava, ceniza, arena, grava, roca, suelo fino, sal, nieve, vegetación |
| Rocas sueltas (más de 10 cm) | ninguna (menos del 2 % del suelo), poca (2 a 10 %), moderada (10 a 30 %), mucha (más del 30 %) |
| Tamaño típico | guijarros (menos de 10 cm), piedras (10 a 30 cm), bloques (30 cm a 1 m), grandes (más de 1 m) |
| Vegetación | ninguna, escasa, moderada, densa |
| Confianza | baja, media, alta |

Las definiciones que usa la pantalla están en `src/features/world/terrainReading.ts`.

## Lo que la IA no decide

- **La confianza tiene techo.** Es «alta» solo con 4 fotos útiles o más, «media» con 2 o 3 y «baja» con una, diga lo que diga el modelo.
- **Las rocas solo se cuentan en fotos de cerca.** Si ninguna muestra el suelo a pocos metros, de las rocas no se dice nada (`rockCover: null`) y el simulador usa rocas de práctica.
- **Sin fotos útiles no hay lectura** (`summary: null`). No se rellena.
- La respuesta llega con un formato fijo y se valida: un valor fuera de las clases se descarta.

## Uso

```bash
python scripts/fotos/leer.py --env ../velkaris-prometheus/.env            # los lugares que falten
python scripts/fotos/leer.py --env RUTA/.env --solo paramo-del-cotopaxi   # uno, para probar
python scripts/fotos/leer.py --env RUTA/.env --todo                       # repetir todos
```

- Solo necesita Python 3 e internet.
- La clave se lee de la variable `GEMINI_API_KEY` o, con `--env`, de un archivo `CLAVE=VALOR` como el `.env` del backend. No se escribe en la salida ni en pantalla.
- Tarda unos 20 minutos: hace pausas, porque Wikimedia limita las descargas seguidas. Guarda cada lugar en cuanto lo lee: si se interrumpe, al repetirlo continúa donde quedó.
- `--modelo` cambia el modelo (por defecto `gemini-3.5-flash`). Cada lugar guarda con qué modelo se leyó.
- **Cuota gratuita:** una clave sin facturación admite 20 consultas al día en `gemini-3.5-flash`. Si se acaban, el script se detiene con el avance guardado; se termina con `--modelo gemini-flash-lite-latest`, que tiene su propia cuota.

## Límites que hay que tener presentes

- **Es una estimación, no una medición.** Clases amplias, a ojo de una IA.
- **Las fotos no son del punto exacto.** Están a menos de 10 km y las subieron voluntarios: pueden mostrar un sendero, un mirador o la cumbre, no el sitio donde rodaría el robot.
- **Pocas fotos, poca confianza.** En lugares remotos casi no hay fotos con ubicación.
- **La IA puede equivocarse** al juzgar tamaños sin una referencia de escala. Por eso la pantalla muestra las fotos usadas: cualquiera puede comprobarlo.
- Las fotos son de sus autores, con su licencia; la aplicación muestra el autor y la licencia de cada una y enlaza a su página en Commons.
