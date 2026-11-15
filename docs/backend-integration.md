# Integración con el backend

Repositorio de referencia: https://github.com/SuperGallinazo27/velkaris-prometheus

El backend es una API en FastAPI (`api/`) con base de datos PostgreSQL, además de la aplicación Streamlit original (`app.py`) y los módulos de cálculo (`prometheus/`). Este frontend usa de él las cuentas y la sesión. El análisis de terreno de las pantallas todavía sale de los datos de este repositorio.

## Análisis de terreno: propuesta, todavía no implementada

1. Crear en el proyecto Python una API (por ejemplo FastAPI) que reutilice la carga y el ranking actuales. Acordar esquema, unidades, manejo de empates y versión antes de conectarla.
2. Proponer `GET /api/v1/regions`, `GET /api/v1/candidates` y `POST /api/v1/rankings` con un `regionId`. Estas rutas **no existen por el hecho de estar documentadas aquí**.
3. Incorporar un adaptador en `src/services/`, validar respuestas en ejecución y convertir sus campos al tipo `Terrain`. Implementar estados de carga, cancelación, error y vacío. Nunca sustituir silenciosamente un fallo de API por datos demo.
4. Configurar `VITE_API_BASE_URL` y CORS con orígenes explícitos. Usar HTTPS en producción. Las variables `VITE_*` son públicas; claves y credenciales deben permanecer en el servidor.
5. Adjuntar a cada conjunto de datos procedencia, instrumento, identificador, fecha, unidades, resolución, licencia, incertidumbre y `isDemo`. Mostrar siempre su estado en la interfaz. Descartar valores no finitos y validar rangos antes del ranking.
6. Añadir pruebas de contrato y comparar resultados con Python, incluidos empates y conjuntos vacíos. Riesgos y economía necesitan contratos y validación separados: no se infieren del ranking topográfico.

## Cuentas y sesión

**Ya conectado.** Con `VITE_API_BASE_URL` definida, `src/services/authHttp.ts` usa estas rutas del backend (contrato completo en su `docs/ACCOUNTS.md`):

| Ruta | Quién | Para qué |
| --- | --- | --- |
| `POST /api/v1/auth/login` | cualquiera | Ingresar; devuelve el token de sesión |
| `GET /api/v1/auth/me` | con sesión | Recuperar la sesión al recargar |
| `POST /api/v1/auth/logout` | con sesión | Anular el token |
| `POST /api/v1/auth/registration` | cuenta pendiente | Definir la clave propia y los datos de la agencia |
| `GET /api/v1/users` | administrador | Listar cuentas |
| `POST /api/v1/users` | administrador | Abrir el acceso de una agencia con clave temporal |
| `PATCH /api/v1/users/{id}` | administrador | Corregir correo o datos |
| `DELETE /api/v1/users/{id}` | administrador | Eliminar una cuenta |
| `POST /api/v1/users/{id}/temporary-password` | administrador | Dar otra clave temporal |

Cómo viaja la sesión: el servidor entrega un token al ingresar y el frontend lo envía en la cabecera `Authorization: Bearer`. Se guarda en el almacenamiento del navegador para sobrevivir a una recarga; el servidor lo vence a las pocas horas y lo anula al cerrar sesión. Los códigos de error del servidor se traducen a los que ya manejaban las pantallas (tabla `CODES` de `authHttp.ts`).

Lo que conviene saber antes de usarlo con personas reales:

1. **El token está al alcance del código de la página.** Un fallo de tipo XSS podría robarlo. La alternativa más segura, una cookie `HttpOnly`, exige que frontend y backend compartan dominio; con Vercel y Render por separado no es posible sin un dominio propio.
2. **La clave temporal se entrega a mano.** Falta enviarla por correo desde el servidor.
3. **Las rutas de análisis del backend siguen siendo públicas**, como estaban. Protegerlas es añadir la misma dependencia que usan las de cuentas.
4. Sin `VITE_API_BASE_URL`, la aplicación usa la demostración guardada en el navegador y lo avisa en pantalla. Nunca cambia de un modo a otro por su cuenta.

## Localidades del mundo interactivo

La lista de lugares está en `src/features/world/places.json`. Para la Luna, sus descriptores son reales y los calcula `scripts/terreno/calcular.py` (LOLA para la Luna, Copernicus DEM para la Tierra); el resultado queda en `src/data/terrenoReal.json`, con sus fuentes. Para Marte siguen siendo sintéticos.

El cálculo sigue la definición `prometheus_topography_plane_v1` del backend (ventana de 3 km, malla de 30 m, relieve, pendiente media y RMS respecto a un plano), con tres diferencias que impiden tratarlo como el mismo producto: usa Copernicus DEM en vez de NASADEM, una proyección acimutal local en vez de UTM, y resume cada área con la mediana de varias ventanas. Antes de cargar estas regiones lunares como objetivos del backend (`PROMETHEUS_TARGETS_PATH`) hay que decidir cuál de las dos variantes se adopta y recalcular con ella en ambos lados.

Una ruta como `GET /api/v1/zones?world=moon&region=haworth` debería devolver continente, país, provincia, zona, coordenadas y los mismos tres descriptores, con su procedencia.

## Modelo de ranking actual

`distance = (abs(reliefA-reliefB)/1000 + abs(slopeA-slopeB)/15 + abs(roughnessA-roughnessB)/100) / 3`.

Los nombres camelCase del frontend son un contrato local, no el formato confirmado de una API. Menor distancia significa menor diferencia en estos tres descriptores ilustrativos, no equivalencia científica. La pantalla la muestra como **coincidencia** = 100 × (1 − distancia), con similitud alta (85 % o más), media (60 a 84 %) o baja. No hay IA entrenada, pronóstico solar ni predicción geomagnética.

## Turnos, copiloto y El Niño

Tres servicios del backend que el frontend ya usa, además de las cuentas. Los tres necesitan `VITE_API_BASE_URL`.

| Qué | Rutas | Cliente | Sin backend |
| --- | --- | --- | --- |
| Portal de turnos | `/api/v1/places…` y `/api/v1/reservations…` (sesión de una cuenta activa) | `src/services/turnosHttp.ts` | `turnosLocal.ts` guarda los turnos en el navegador con las mismas reglas |
| Copiloto de IA | `POST /api/v1/assistant/ask` (sesión de una cuenta activa) | `src/services/assistant.ts` | No hay copiloto: la clave de la IA vive solo en el servidor, y la pantalla lo explica |
| Índice de El Niño | `GET /api/v1/climate/enso` (público) | `src/services/enso.ts` | Usa la copia con fecha de `src/data/enso.json` |

- El contrato de los turnos está en `docs/TURNOS.md` del backend; el del copiloto y el de El Niño, en su `docs/API.md`.
- **El servidor decide.** El navegador muestra si un lugar se puede reservar, pero quien comprueba el área protegida, las fechas y que nadie más tenga el lugar es el backend, con su propia copia del catálogo (`data/lugares.json`, generada por `scripts/protegidas/calcular.py`).
- **La IA solo recibe datos del lugar y del plan** (`src/features/ai/context.ts`). No viajan el correo, el nombre ni la institución de quien pregunta, y el servidor le ordena responder solo con esos datos. Explica y redacta; no calcula.
- Un backend anterior a estas rutas responde 404: el frontend lo reconoce y pide reiniciar la API.
