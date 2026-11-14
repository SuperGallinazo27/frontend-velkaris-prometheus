# Integración futura con Python

Repositorio de referencia: https://github.com/SuperGallinazo27/velkaris-prometheus

La versión inspeccionada contiene una aplicación Streamlit (`app.py`) y módulos Python (`prometheus/data.py`, `prometheus/ranking.py`). No se ha verificado una API HTTP existente. Este frontend funciona por separado y no modifica aquel repositorio. No intenta consultar Streamlit como si fuera una API REST.

## Propuesta, todavía no implementada

1. Crear en el proyecto Python una API (por ejemplo FastAPI) que reutilice la carga y el ranking actuales. Acordar esquema, unidades, manejo de empates y versión antes de conectarla.
2. Proponer `GET /api/v1/regions`, `GET /api/v1/candidates` y `POST /api/v1/rankings` con un `regionId`. Estas rutas **no existen por el hecho de estar documentadas aquí**.
3. Incorporar un adaptador en `src/services/`, validar respuestas en ejecución y convertir sus campos al tipo `Terrain`. Implementar estados de carga, cancelación, error y vacío. Nunca sustituir silenciosamente un fallo de API por datos demo.
4. Configurar `VITE_API_BASE_URL` y CORS con orígenes explícitos. Usar HTTPS en producción. Las variables `VITE_*` son públicas; claves y credenciales deben permanecer en el servidor.
5. Adjuntar a cada conjunto de datos procedencia, instrumento, identificador, fecha, unidades, resolución, licencia, incertidumbre y `isDemo`. Mostrar siempre su estado en la interfaz. Descartar valores no finitos y validar rangos antes del ranking.
6. Añadir pruebas de contrato y comparar resultados con Python, incluidos empates y conjuntos vacíos. Riesgos y economía necesitan contratos y validación separados: no se infieren del ranking topográfico.

## Modelo de ranking actual

`distance = (abs(reliefA-reliefB)/1000 + abs(slopeA-slopeB)/15 + abs(roughnessA-roughnessB)/100) / 3`.

Los nombres camelCase del frontend son un contrato local, no el formato confirmado de una API. Menor distancia significa menor diferencia en estos tres descriptores ilustrativos, no equivalencia científica. No hay IA entrenada, pronóstico solar ni predicción geomagnética.
