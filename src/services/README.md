# Adaptadores de datos

Punto de extensión para la futura API Python. Los datos de análisis vienen de `src/data/demo.ts` (sintéticos), de `src/features/world/places.json` (lista de lugares) y de `src/data/terrenoReal.json` (terreno real de la Luna y de la Tierra, generado por `scripts/terreno/`). No hay solicitudes remotas ni claves requeridas. Consulta `docs/backend-integration.md` antes de implementar un cliente.

## Cuentas y sesión

- `auth.ts`: la interfaz `AuthApi` que usan las pantallas y su versión de demostración, con cuentas guardadas en el navegador. Esa versión no es seguridad real.
- `authHttp.ts`: la misma interfaz contra el backend (FastAPI + PostgreSQL). La sesión es un token del servidor.
- `session.ts`: usa `authHttp.ts` si existe `VITE_API_BASE_URL` y la demostración si no, y ofrece los hooks `useSession` y `useSessionPending`.
- `countries.ts`: la lista de países (ISO 3166-1, nombres en español de CLDR) del desplegable «País» y el reconocimiento de un país escrito a mano («ecuador» → «Ecuador»). En la cuenta se guarda el nombre.

## Portal de turnos

- `turnosRules.ts`: las reglas puras. Qué lugares se pueden reservar según la base mundial de áreas protegidas (`src/data/areasProtegidas.json`, de `scripts/protegidas/`) y las categorías de la UICN, la decisión del administrador sobre un lugar y las fechas de un turno. El servidor aplica las mismas reglas.
- `turnosModel.ts`: la interfaz `TurnosApi` que usan las pantallas, los tipos de un turno y los mensajes comunes.
- `turnosHttp.ts`: la interfaz contra el backend. El servidor decide los permisos, la regla de áreas protegidas y el choque de fechas.
- `turnosLocal.ts`: la misma interfaz en la demostración, con los turnos guardados en el navegador. No es seguridad real.
- `turnos.ts`: usa `turnosHttp.ts` si existe `VITE_API_BASE_URL` y la demostración si no.

## Datos en vivo

- `weather.ts`: clima actual de un punto, desde Open-Meteo.
- `recentRain.ts`: lluvia que de verdad cayó en un punto en los últimos 30 días, desde Open-Meteo. Con ella, la pestaña «Clima» corrige el recuadro «Ahora» cuando el año se aparta del promedio.
- `enso.ts`: estado de El Niño / La Niña (índices de NOAA). Con servidor lo pide en vivo a `/api/v1/climate/enso`; sin servidor usa la copia con fecha de `src/data/enso.json`.
- `photos.ts`: fotos cercanas a un punto, desde Wikimedia Commons.

Ninguno necesita clave. Solo envían las coordenadas del lugar.

## Copiloto (IA)

- `assistant.ts`: envía una pregunta y los datos del lugar al backend (`POST /api/v1/assistant/ask`), que consulta a Gemini. La clave de la IA vive solo en el servidor: sin `VITE_API_BASE_URL` no hay copiloto y la pantalla lo explica. Solo viajan datos del lugar y del plan (`src/features/ai/context.ts` decide cuáles); no se envían el correo, el nombre ni la institución de quien pregunta.
