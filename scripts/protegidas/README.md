# Áreas protegidas de cada lugar (portal de turnos)

`calcular.py` consulta la base mundial de áreas protegidas para los 37 lugares de `src/features/world/places.json` y genera:

- **`src/data/areasProtegidas.json`**: lo que muestra la aplicación. Para cada lugar, las áreas que contienen su punto (`atPoint`) y las que solo tocan el recuadro de 18 km que se analiza (`nearby`).
- **`../velkaris-prometheus/data/lugares.json`**: el catálogo del servidor (lugar, coordenadas y sus áreas). Con él, el servidor decide si un lugar se puede reservar, sin fiarse del navegador.

```bash
python scripts/protegidas/calcular.py                  # consulta solo los lugares que faltan
python scripts/protegidas/calcular.py --todo           # vuelve a consultar todos (por ejemplo, cada mes)
python scripts/protegidas/calcular.py --backend RUTA   # si el backend está en otra carpeta
```

Solo usa la biblioteca estándar de Python. Tarda unos minutos: hace tres consultas por lugar, una tras otra y con una pausa entre ellas. Guarda cada lugar en cuanto llega; si alguno falla queda en `failed` y basta con volver a ejecutarlo.

## La fuente

**World Database on Protected and Conserved Areas (WDPCA)**, de UNEP-WCMC y la UICN. Reúne las áreas protegidas que declaran los países y las de convenios internacionales (Patrimonio Mundial, Ramsar, Reservas de la Biosfera). Se publica cada mes en https://www.protectedplanet.net/.

El script usa su servicio público de mapas (ArcGIS):
https://data-gis.unep-wcmc.org/server/rest/services/ProtectedSites/The_World_Database_of_Protected_Areas/MapServer

| Consulta | Capa | Para qué |
| --- | --- | --- |
| Polígonos que contienen el punto del lugar | 1 | **Deciden** si se puede reservar |
| Polígonos que tocan el recuadro de 18 km | 1 | Aviso: «cercanas» |
| Áreas que la base solo tiene como un punto, dentro del recuadro | 0 | Aviso: sin límites no se sabe si contienen el lugar |

De cada área se guardan los atributos tal como vienen: identificador, nombre original y en inglés, designación original y en inglés, tipo de designación, **categoría de manejo de la UICN**, estado y año, gobernanza, autoridad de manejo y país. No se inventa ni se corrige nada.

## Qué se hace con esto

La regla está en `src/services/turnosRules.ts` y, en el servidor, en `api/services/places.py`. Es un criterio de PROMETHEUS apoyado en las categorías de la UICN, no un dictamen legal:

| En el punto del lugar hay… | Resultado |
| --- | --- |
| un área de categoría Ia, Ib, II, III o IV (protección estricta) | no se puede reservar, y se dice por qué |
| solo áreas de categoría V o VI, o sin categoría informada | se reserva declarando el permiso de la autoridad del área |
| ninguna área | se reserva |

El administrador puede cerrar un lugar o habilitar uno bloqueado, siempre con un motivo que la agencia ve.

Resultado con la versión de **octubre de 2026** (consultada el 15 de noviembre de 2026):

- **11 no reservables**: Ischigualasto, Sierra Negra (Parque Nacional Galápagos), Páramo del Cotopaxi, Craters of the Moon, El Pinacate, Pico de Orizaba, Askja, Timanfaya, Bockfjorden, Monte Etna y Desierto del Namib.
- **7 con permiso**: Valle de la Luna, Campo de Piedra Pómez, Arenal del Chimborazo, Landmannalaugar, Erfoud, Cráter Ramon y Tolbachik.
- **19 sin área protegida en el punto**.

## Límites

- **La base puede estar incompleta.** Un lugar sin polígono en su punto no garantiza que no exista un área protegida. Ejemplo: los Valles Secos de McMurdo no tienen ninguna en la base en ese punto, y sin embargo son una Zona Antártica Especialmente Administrada (ASMA 2) del Tratado Antártico.
- **Solo decide el punto.** El punto de «Valle de la Muerte» (Furnace Creek) cae en un hueco del polígono del Parque Nacional Death Valley, que empieza a menos de 200 m: sale sin área protegida, aunque casi todo su recuadro de 18 km es parque. Por eso la aplicación marca como «junto a área protegida» los lugares cuyo recuadro toca un área de protección estricta y lo avisa al reservar. Son seis: Valle de la Muerte, Mauna Loa, Hanksville, Arkaroola, Desierto de Rangipo y Río Tinto.
- **Los límites son los que entrega cada país**, con distinta precisión.
- **La categoría la informa cada país**, y muchos sitios internacionales no tienen: por eso «sin categoría informada» pide permiso en lugar de bloquear.
- Una propuesta de área (`Proposed`) todavía no está vigente: se guarda, pero no decide.

## Condiciones de uso

Las fija Protected Planet: https://www.protectedplanet.net/en/legal. En resumen:

- **Uso no comercial.** Para uso comercial hay que pedir permiso a UNEP-WCMC (se gestiona a través de IBAT).
- **Se puede publicar en línea**, entera o en parte, si los datos **no son descargables**, la **cita está a la vista**, se indica **el mes y el año de la versión** y hay un enlace a Protected Planet. La aplicación lo cumple: muestra la cita con el mes en la pestaña «Turnos» de cada lugar y en la pantalla del administrador, y no ofrece ninguna descarga de estos datos.
- **No se puede redistribuir** la base, ni entera ni en parte, tampoco dentro de trabajos derivados.
- Hay que usar la versión más reciente: conviene volver a ejecutar el script cada mes.

**Ojo con el repositorio.** Los dos archivos que genera este script son un extracto pequeño de la base (los atributos de las áreas alrededor de 37 puntos). Publicarlos en un repositorio abierto podría entenderse como redistribuir una parte. Para un proyecto abierto o que dure más allá de la demostración hay dos caminos: pedir permiso a UNEP-WCMC (el contacto está en la página de condiciones) o dejar los archivos fuera del repositorio y generarlos al desplegar.

Cita, tal como la da el servicio:

> UNEP-WCMC and IUCN (2026), Protected Planet: The World Database on Protected and Conserved Areas (WDPCA) [On-line], [October 2026], Cambridge, UK: UNEP-WCMC and IUCN. Available at: https://www.protectedplanet.net/.
