# Datos del hangar

De aquí salen los textos del **Hangar**: de qué está hecho cada robot, sus datos publicados, en qué otras misiones voló cada pieza («herencia de vuelo») y su historial de misiones.

## Qué hay

| Archivo | Qué es |
|---|---|
| `investigacion/datos-<robot>.json` | Lo que se comprobó de cada robot (Perseverance, Curiosity, VIPER y el carro lunar del Apolo; el de VIPER trae también CADRE, DuAxel y EELS). Cada dato lleva la página de donde salió (`source`) y una **cita textual** de esa página (`quote`). |
| `interfaz.json` | Los textos fijos de la pantalla del hangar y del control por gestos, con su traducción al inglés. |
| `armar.py` | Junta todo: escribe `src/data/hangar.json` (lo que muestra la aplicación, en español) y añade las traducciones a `src/i18n/en.json`. |

## Cómo se hizo la investigación

- Fuentes admitidas: NASA, JPL, NSSDC, ESA, el Smithsonian, informes técnicos de NASA (NTRS) y artículos científicos. Wikipedia y la prensa, no.
- Cada dato se leyó en la página y se guardó con una cita de 25 palabras o menos que lo respalda. Lo que no se pudo comprobar no está.
- Las fuentes se consultaron el 22 de noviembre de 2026. El estado de las misiones cambia: VIPER, por ejemplo, figura como «previsto para 2027», no como confirmado.
- El campo `notes` de cada archivo cuenta lo que no se pudo verificar y dónde las fuentes no coinciden (por ejemplo, los kilómetros del carro lunar: se usan los de NSSDC).
- El año de la herencia es el del lanzamiento de esa misión; si es futuro, la aplicación lo marca como «previsto».

## Actualizar

1. Corrige o añade datos en `investigacion/` (con su fuente y su cita) o textos en `interfaz.json`.
2. Desde la raíz del frontend: `python scripts/hangar/armar.py`.
3. `bun test` comprueba que cada componente tiene datos y fuente, que cada dato guarda su cita y que todo tiene traducción.

Los componentes de cada robot (sus identificadores) están en `src/features/hangar/parts.ts`: son los mismos para los datos y para las piezas del holograma.
