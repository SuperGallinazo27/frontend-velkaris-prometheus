# PROMETHEUS · Frontend VELKARIS

**Repositorios del proyecto** (se necesitan los dos):

| Parte | Repositorio |
|---|---|
| Frontend (esta web: React + TypeScript + Vite) | https://github.com/SuperGallinazo27/frontend-velkaris-prometheus |
| Backend (API: FastAPI + PostgreSQL; cuentas, turnos, copiloto IA, El Niño) | https://github.com/SuperGallinazo27/velkaris-prometheus |

Sin el backend, la web funciona en modo demostración: las cuentas y los turnos se guardan solo en el navegador y el copiloto de IA no responde. Para conectarlo, pon la dirección del backend en `VITE_API_BASE_URL` (ver `.env.example`).

Aplicación web para encontrar en la Tierra lugares con terreno parecido al de la Luna, probar allí un robot en un simulador 3D con el suelo y el clima del lugar, y reservar un turno. React + TypeScript + Vite, gestionado con Bun.

> **Qué es real y qué no.** Con la Luna, la comparación usa mediciones: la elevación del láser LOLA de NASA en la Luna y el modelo Copernicus en la Tierra. Solo compara la forma del terreno; no es una validación científica. El clima, el suelo, las áreas protegidas, las fotos y los turnos también salen de datos reales, cada uno con su fuente y sus límites en pantalla. **Marte es todavía una demostración** con valores sintéticos. El inicio de sesión usa el backend cuando está configurado y, si no, una simulación en el navegador.

## Primera vez: empieza aquí

No necesitas tener React instalado ni crear otro proyecto. Este repositorio ya contiene la aplicación. Primero preparas las herramientas de tu computadora y después instalas las dependencias del proyecto.

### 1. Qué necesitas y para qué sirve

| Herramienta | Para qué se usa | Cómo se obtiene |
| --- | --- | --- |
| Node.js | Ejecutar las herramientas de desarrollo de este proyecto. | Instalar una versión compatible; instrucciones abajo. |
| Bun | Descargar las dependencias, iniciar la aplicación y ejecutar las pruebas. | Instalarlo una vez en tu computadora. |
| Git | Descargar el repositorio y trabajar con su historial de cambios. | Instalarlo si usarás `git clone`; también puedes descargar un ZIP. |
| Navegador | Ver y probar la interfaz. | Usar un navegador moderno. |
| Editor de código | Modificar archivos del proyecto. | Puedes usar el editor que prefieras, por ejemplo VS Code; es opcional para ejecutar la app. |

**React, React DOM, TypeScript y Vite se descargan automáticamente con `bun install`.** No los instales globalmente ni ejecutes `create-vite`: el proyecto ya está preparado.

Necesitas internet para descargar las herramientas y dependencias. Para probar la aplicación no necesitas Python, una cuenta NASA, claves API ni configurar un archivo `.env`. Las cuentas reales sí necesitan el backend en marcha (ver [Cuentas y acceso](#cuentas-y-acceso)).

### 2. Abre una terminal

La terminal es la aplicación donde escribirás los comandos de esta guía:

- **Windows:** abre PowerShell desde el menú Inicio.
- **macOS:** abre Terminal desde Aplicaciones → Utilidades.
- **Linux:** abre la aplicación Terminal de tu distribución.
- Si usas VS Code, también puedes abrir Terminal → Nueva terminal dentro de la carpeta del proyecto.

Copia **un comando a la vez**, pulsa Enter y espera a que termine antes del siguiente. No copies las marcas del bloque de código ni agregues `\` al final de las líneas. Las direcciones HTTPS se escriben normalmente, como `https://github.com/...`.

### 3. Instala Node.js

Para seguir el entorno usado en las comprobaciones del proyecto, instala **Node.js 24 LTS** desde la [página oficial de descargas](https://nodejs.org/en/download). El mínimo declarado por este repositorio es Node.js 22.12.

- **Windows:** selecciona Windows y el instalador `.msi`.
- **macOS:** selecciona macOS y el instalador `.pkg` compatible con tu equipo.
- **Linux:** selecciona tu sistema y sigue las instrucciones de instalación de la página oficial.

Completa la instalación, cierra y vuelve a abrir la terminal. Comprueba:

```bash
node --version
```

Debe mostrar un número de versión, por ejemplo `v24.x.x` si instalaste Node.js 24. Si ya tienes una versión compatible, puedes conservarla. Consulta también los [requisitos oficiales de Vite](https://vite.dev/guide/).

### 4. Instala Bun

El proyecto utiliza **Bun 1.4.4 o posterior**; la comprobación automática de GitHub usa 1.4.4. Sigue la [guía oficial de Bun](https://bun.sh/docs/installation).

**Windows — en PowerShell:**

```powershell
powershell -c "irm bun.sh/install.ps1 | iex"
```

**macOS o Linux — en Terminal:**

```bash
curl -fsSL https://bun.com/install | bash
```

Estos comandos descargan y ejecutan el instalador oficial de Bun. En Linux, el instalador requiere `unzip`. Si no puedes usar este método, la guía oficial ofrece otras opciones, incluida la instalación mediante npm después de instalar Node.js.

Al terminar, cierra y vuelve a abrir la terminal; si usas VS Code, reinícialo también. Comprueba:

```bash
bun --version
```

Debe mostrar `1.4.4` o una versión posterior. Si tu equipo no permite instalar herramientas, necesitarás un entorno de desarrollo autorizado que ya las incluya. Descargar el repositorio por sí solo no permite ejecutarlo sin ellas.

### 5. Descarga el proyecto

Elige **una** de estas dos opciones.

**Opción A — con Git, recomendada para desarrollar**

Si todavía no tienes Git, instálalo desde sus [descargas oficiales](https://git-scm.com/downloads). Después vuelve a abrir la terminal y comprueba:

```bash
git --version
```

Abre la terminal en la carpeta donde quieras guardar tus proyectos. Ejecuta:

```bash
git clone https://github.com/SuperGallinazo27/frontend-velkaris-prometheus.git
```

Cuando termine la descarga, entra a la carpeta creada:

```bash
cd frontend-velkaris-prometheus
```

El repositorio es público: no necesitas iniciar sesión en GitHub para descargarlo. Para publicar cambios sí necesitarás autenticación y permisos.

**Opción B — sin instalar Git**

1. Abre [el repositorio en GitHub](https://github.com/SuperGallinazo27/frontend-velkaris-prometheus).
2. Pulsa **Code → Download ZIP**.
3. Descomprime el archivo. Normalmente obtendrás una carpeta llamada `frontend-velkaris-prometheus-main`.
4. Abre esa carpeta en tu editor y abre una terminal dentro de ella. También puedes usar `cd` seguido de su ruta entre comillas.

Con ambas opciones debes quedar dentro de la carpeta que contiene **`package.json`**, `bun.lock`, `src` e `index.html`. El ZIP evita instalar Git, pero sigue necesitando Node.js y Bun para trabajar localmente.

### 6. Instala las dependencias

Desde esa carpeta, ejecuta:

```bash
bun install
```

Este paso descarga React, TypeScript, Vite y las demás dependencias y crea la carpeta `node_modules`. La primera vez puede tardar: espera a que finalice sin errores. No copies ni subas `node_modules` a GitHub.

### 7. Inicia la aplicación

```bash
bun dev
```

La terminal mostrará una dirección junto a **Local**, normalmente:

```text
http://localhost:5173/
```

Abre **la dirección que aparezca en tu terminal** en el navegador. Si el puerto está ocupado, puede ser otro, como `5174`.

Mantén la terminal abierta mientras usas la aplicación. Es normal que no vuelva a quedar libre para escribir: el servidor está funcionando. Para detenerlo, pulsa **Ctrl+C**.

No abras `index.html` con doble clic; durante el desarrollo la aplicación se sirve con `bun dev`.

### 8. Edita y vuelve a trabajar otro día

Abre la carpeta completa en tu editor. Un primer archivo para explorar es `src/app/App.tsx`; los estilos están en `src/styles/global.css` y los ejemplos sintéticos en `src/data/demo.ts`.

Mientras `bun dev` está activo, guarda un cambio y revisa el navegador: Vite normalmente actualiza la vista automáticamente.

Otro día solo necesitas abrir una terminal **en la carpeta del proyecto** y ejecutar:

```bash
bun dev
```

No necesitas clonar de nuevo ni reinstalar las herramientas cada vez. Ejecuta `bun install` otra vez si cambian `package.json` o `bun.lock`, o si falta `node_modules`.

## Comprobar y preparar la aplicación

Para comprobar TypeScript y generar los archivos de producción:

```bash
bun run build
```

Si termina correctamente, crea `dist/`. Para ver ese resultado localmente, ejecuta después:

```bash
bun run preview
```

Abre la dirección que muestre la terminal. Este comando permite revisar el resultado; **no publica la web en internet**.

Para ejecutar las pruebas de ranking y presupuesto:

```bash
bun test
```

`bun.lock` fija las dependencias. En una comprobación reproducible se usa `bun install --frozen-lockfile`, que respeta ese archivo y falla si necesita cambiarlo. `private: true` en `package.json` evita publicar accidentalmente el paquete en npm; no determina la visibilidad del repositorio en GitHub.

## Problemas frecuentes

| Lo que ves | Qué comprobar |
| --- | --- |
| `bun: command not found` o “bun no se reconoce” | Instala Bun y vuelve a abrir la terminal o VS Code. Si persiste, sigue la sección de PATH de la guía oficial de Bun. |
| `node` no se reconoce o aparece un error de versión | Instala una versión compatible de Node.js y abre una terminal nueva. Comprueba `node --version`. |
| `git` no se reconoce | Instala Git o usa la descarga ZIP. |
| No se encuentra `package.json` o el script `dev` | Estás en otra carpeta. Entra en la carpeta del proyecto que contiene `package.json`. |
| No se encuentra `vite` o faltan módulos | Ejecuta `bun install` dentro del proyecto y espera a que termine correctamente. |
| La carpeta de destino ya existe al clonar | Si ya descargaste este proyecto, entra a esa carpeta. No necesitas repetir `git clone`. |
| `bun install` falla por conexión o permisos | Revisa tu conexión y usa una carpeta donde puedas escribir. Si es un equipo administrado, consulta a su responsable. |
| El navegador no abre la aplicación | Confirma que `bun dev` siga activo y usa la URL exacta indicada junto a Local. |
| El comando sigue ejecutándose después de `bun dev` | Es normal: está atendiendo la aplicación. Deténlo con Ctrl+C cuando termines. |

Si necesitas ayuda, comparte el comando que ejecutaste, el mensaje de error y tu sistema operativo, sin contraseñas ni claves.

## Funciones

- Portada con una escena 3D que sigue el scroll: de la Tierra a la Luna, después a Marte y de regreso, en seis capítulos. Con la Luna muestra datos reales: tres regiones medidas y los tres lugares de la Tierra con más coincidencia con cada una.
- Inicio de sesión con dos roles, contra el backend o en modo de demostración: el administrador gestiona cuentas, turnos y lugares; la agencia entra al mundo interactivo y reserva.
- Mundo interactivo: un globo 3D navegable con lugares de la Tierra comparados con veinte regiones reales de la Luna, con su similitud (alta, media o baja) y su porcentaje de coincidencia, desglosados por continente, país, provincia y zona.
- Cada lugar, de cerca: mapa satelital con relieve 3D, terreno y cómo se llega (aeropuerto, carretera, poblado y hospital más cercanos), ruedas, clima (el típico y el de ahora, con la lluvia real y El Niño), temperatura del suelo, fotos con una lectura del terreno hecha por IA, y turnos.
- **Portal de turnos:** una agencia reserva un lugar para unos días; si otra ya lo tiene, sale «ocupado»; dentro de un área de protección estricta no se puede reservar y se explica por qué, con la base mundial de áreas protegidas.
- Centro de misión por lugar: gemelo digital descargable, prueba del robot en 3D, costo desde tu ubicación, plan de campaña con su turno y un copiloto de IA que explica el lugar y redacta el resumen del plan.
- Búsqueda amplia: para cada región lunar, zonas nuevas de la Tierra por explorar, fuera de la lista.
- **Hangar:** cada robot como un holograma que se gira y se desarma pieza a pieza, con los datos publicados de cada componente, en qué otras misiones voló («herencia de vuelo»), su historial real y tus pruebas en el simulador.
- **Control por gestos:** con la cámara, la mano conduce el robot en el simulador y mueve el holograma del hangar. La imagen se analiza en el navegador y no sale del equipo.
- Marte es todavía una demostración con valores sintéticos, y cada pantalla lo dice.
- Navegación por teclado, etiquetas accesibles y diseño adaptable a móvil.

- Interruptor de idioma **ES / EN** en la portada, en el ingreso y en la barra de cada pantalla. Cambia toda la interfaz al momento, sin recargar, y recuerda la elección.

## Idioma (español e inglés)

La aplicación está escrita en español. El modo inglés traduce lo que ya se ve, sin tocar la lógica:

- `src/i18n/en.json` es el diccionario: textos fijos (`exact`), textos con valores (`templates`, como `"Se atascó a los {0} m"`) y trozos de textos que llegan armados del servidor (`phrases`, como «categoría UICN»).
- `src/i18n/translator.ts` busca cada texto en el diccionario; `src/i18n/dom.ts` lo aplica a la página y lo mantiene al día mientras React la actualiza; al volver a español, cada texto recupera su original.
- Los nombres de países salen del navegador (`Intl.DisplayNames`). Los nombres propios de lugares se quedan como están.
- El diccionario solo se descarga si alguien elige inglés, y la elección vale para todas las pestañas.
- El copiloto responde en inglés cuando la interfaz está en inglés (el servidor lo lee del contexto).
- Lo que no esté en el diccionario se queda en español: para traducir un texto nuevo, añádelo a `en.json`. Las pruebas están en `tests/idioma.test.ts`.

## Hangar y control por gestos

### Hangar (`#hangar`)

Está en la barra de toda cuenta activa, junto al Mundo. Muestra los siete robots del catálogo:

- **Holograma.** Perseverance y Curiosity usan el modelo 3D oficial de NASA; VIPER y el carro lunar del Apolo, formas simplificadas con sus medidas publicadas. Se gira arrastrando, se acerca con la rueda y se **desarma** con el control «Desarmar»: cada pieza se separa del robot. «Holograma / Real» cambia entre la vista de luz y los materiales del modelo.
- **Componentes.** Cada pieza numerada tiene su ficha: qué es, dos o tres datos publicados con su fuente y su **herencia de vuelo**, es decir, las otras misiones en las que voló (o volará, marcado como «previsto») esa misma pieza o su diseño. Por ejemplo, la suspensión rocker-bogie del Perseverance viene de Sojourner, Spirit y Opportunity y Curiosity.
- **Historial.** Las misiones reales de cada robot, con sus hitos fechados y su fuente, y **tus pruebas en PROMETHEUS**: cada prueba terminada en el simulador queda anotada (lugar, metros, patinaje, pendiente, si se atascó). Con ellas, algunas piezas cuentan cómo les fue: «en tus pruebas, sus ruedas patinaron como máximo un 34 %».
- **Probar en el simulador.** El botón lleva al Mundo; al abrir «Prueba del robot» en un lugar, el simulador arranca con ese robot.
- CADRE, DuAxel y EELS no tienen modelo 3D publicado: se muestran sin holograma, con su ficha y su historial.

Qué es real: los datos de los componentes, la herencia y los hitos salen de NASA, JPL, NSSDC, ESA y el Smithsonian, cada uno con su fuente; la cita textual que respalda cada dato está en [scripts/hangar/](scripts/hangar/README.md). La bitácora de pruebas se guarda en el navegador, por cuenta, y son resultados del simulador, no pruebas de campo. En el Curiosity, cuyo modelo oficial viene en una sola pieza, los componentes se separaron por su posición.

### Control por gestos

Con el botón «Con la mano» (en el simulador y en el hangar) se enciende la cámara y un detector de manos lee los gestos:

| Dónde | Gesto | Qué hace |
|---|---|---|
| Simulador | Mano abierta | Avanza |
| Simulador | Inclinar la mano | Gira, como un volante |
| Simulador | Dos dedos | Marcha atrás |
| Simulador | Puño, o ninguna mano a la vista | Frena: el robot nunca sigue solo |
| Hangar | Una mano abierta que se mueve | Gira el holograma |
| Hangar | Dos manos que se separan o se juntan | Lo desarma o lo arma |
| Hangar | Puño | Lo suelta, para recolocar la mano |
| Hangar | Señalar un momento con el índice | Pasa al componente siguiente |

- **Privacidad.** El detector es [MediaPipe](https://ai.google.dev/edge/mediapipe/solutions/vision/gesture_recognizer) (Google, licencia Apache 2.0) y corre entero en el navegador: la imagen de la cámara no se graba ni se envía a ningún servidor.
- **Requisitos.** Una cámara y una dirección segura (`https`) o `localhost`; el navegador pide permiso la primera vez. La mano debe verse entera, a unos 40 a 80 cm, con buena luz.
- **Archivos.** El modelo (`public/mediapipe/gesture_recognizer.task`, 8 MB) está en el repositorio. El motor WebAssembly viene en el paquete `@mediapipe/tasks-vision` y Vite lo copia a `public/mediapipe/wasm/` al arrancar (ver `vite.config.ts`); todo se descarga solo cuando alguien enciende los gestos.
- **Código.** `src/features/gestos/gestures.ts` tiene las reglas (qué gesto es y qué orden da), sin tocar la cámara, y se prueba en `tests/gestos.test.ts`; `GestureCamera.tsx` enciende la cámara y dibuja la mano que entiende el detector.
- **Comprobado** con fotos reales de manos como cámara simulada en un navegador automático. Los umbrales (cuánto inclinar para girar, cuánto separar las manos) están en `gestures.ts` por si hace falta ajustarlos a otra cámara.

## Estructura editable

```text
src/
  app/                  # Composición y navegación
  components/           # Elementos compartidos
  assets/marca/         # Logotipo: emblema y nombre, en blanco y a color
  data/                 # Datos reales ya calculados (terreno, clima, suelo, turnos…) y la demostración de Marte
  features/
    landing/            # Portada: contenido, estilos y escena 3D
    auth/               # Ingreso y registro de la agencia
    admin/              # Panel del administrador
    world/              # Mundo interactivo: globo, mapa del lugar, clima, temperatura del suelo y fotos
    mission/            # Centro de misión: gemelo digital, prueba del robot en 3D, costos y plan
    hangar/             # Hangar: holograma de cada robot, componentes, herencia de vuelo y bitácora de pruebas
    gestos/             # Control por gestos: cámara, detector de manos y reglas de cada gesto
    turnos/             # Portal de turnos: reservar, «Mis turnos» y estado de cada lugar
    ai/                 # Copiloto: qué datos recibe la IA y su pantalla
    ranking/            # Distancia entre descriptores
  services/             # Cuentas y turnos (servidor o demostración), clima, El Niño, fotos y copiloto
  three/                # Piezas 3D compartidas: cielo, estrellas y matemática
  styles/               # Diseño adaptable
  types/                # Contratos TypeScript
tests/                  # Pruebas del dominio
scripts/                # Datos calculados en Python: terreno, clima, suelo, temperatura, áreas protegidas, accesos, lectura de fotos, búsqueda amplia y hangar
docs/                   # Integración con el backend
public/                 # Recursos públicos
```

Los archivos fuente se pueden editar directamente en GitHub o localmente. `node_modules` y `dist` están excluidos. El build genera un sitio estático; publicar el repositorio no equivale a desplegar el sitio. Para alojarlo bajo una subcarpeta, configura `base` en `vite.config.ts`.

## Portada

Al abrir la aplicación se muestra la portada. La Tierra es el eje del recorrido: la Luna es el primer alcance y Marte el siguiente. Sus botones llevan al mundo interactivo (`#mundo`), que pide iniciar sesión; «Ingresar» se abre en otra pestaña y la portada queda abierta detrás.

- **Con la Luna, la portada muestra datos reales** (`src/features/landing/portada.ts`): tres regiones medidas, una por zona (Haworth, el alunizaje del Apolo 11 y el cráter Peary), y los tres lugares de la Tierra con más coincidencia de terreno con cada una, con el mismo cálculo que el mundo interactivo.
- **Con Marte es una demostración** con valores sintéticos (`src/data/demo.ts`), y la portada lo dice.
- El explorador antiguo de datos de ejemplo (ranking, riesgos ficticios y calculadora) se retiró: el producto es el mundo interactivo.

La escena usa [Three.js](https://threejs.org/), que se descarga en un archivo aparte solo cuando se muestra la portada.

- **Luna:** muestra el **relieve real medido por el láser LOLA de NASA** (`src/features/landing/luna-lola.webp`, 250 KB, generado por [scripts/luna/](scripts/luna/README.md)). Es relieve sombreado, no una fotografía. Mientras carga, o si falla, se ve la versión dibujada.
- **Tierra, Marte y cielo de galaxia:** se dibujan por código, con ruido procedural y contornos continentales esquemáticos.
- **Marcadores de la Tierra:** los lugares del ranking vigente; la Tierra gira para mostrarlos.

- `src/features/landing/Landing.tsx`: textos y capítulos.
- `src/features/landing/portada.ts`: las regiones lunares de la portada y su ranking real, con pruebas en `tests/portada.test.ts`.
- `src/components/Brand.tsx` y `src/assets/marca/`: el logotipo (emblema blanco para fondos oscuros, a color para tarjetas blancas). El icono de la pestaña es `public/favicon.png`.
- `src/features/landing/journey.ts`: encuadres de cámara por capítulo y la matemática del recorrido, con pruebas en `tests/journey.test.ts`.
- `src/features/landing/scene.ts`: planetas, sonda y animación.
- `src/features/landing/landing.css`: estilos de la portada.

Si el navegador no dispone de WebGL, la portada muestra un fondo estático con el mismo contenido; se puede probar añadiendo `?estatico` a la dirección. Con la preferencia del sistema de reducir el movimiento, o con el botón «Pausar movimiento», la escena queda quieta y la cámara salta de capítulo en capítulo.

## Cuentas y acceso

Sin sesión solo se ven la portada y la pantalla de ingreso. El mundo interactivo, «Mis turnos» y el panel del administrador piden iniciar sesión, y cada rol entra a lo suyo: el administrador gestiona las cuentas y la agencia usa el mundo interactivo.

Las cuentas pueden vivir en dos sitios. Lo decide una sola variable, `VITE_API_BASE_URL`:

| | Con `VITE_API_BASE_URL` | Sin ella |
| --- | --- | --- |
| Dónde están las cuentas | En la base de datos del backend (PostgreSQL) | En el almacenamiento de este navegador |
| Para qué sirve | Uso real | Probar la aplicación sin servidor |
| Claves | El servidor guarda solo su huella (scrypt) | Sin protección real |
| Sesión | Token del servidor, vence a las pocas horas | Guardada en el navegador |
| Aviso en pantalla | — | «DEMO» |

### Con el backend

1. Enciende la **API** del backend [velkaris-prometheus](https://github.com/SuperGallinazo27/velkaris-prometheus): en Windows, doble clic en su archivo `iniciar-api.cmd`, y deja abierta esa ventana. La aplicación Streamlit de ese repositorio (`app.py`) no sirve para esto. La primera vez hay que preparar su entorno, su base de datos y el administrador; los pasos están en su `docs/ACCOUNTS.md`.
2. Crea un archivo `.env.local` en esta carpeta (no se sube a GitHub) con la dirección del backend:

   ```text
   VITE_API_BASE_URL=http://127.0.0.1:8000
   ```

   En Vercel, la misma variable con la dirección HTTPS del backend en Render.
3. Reinicia `bun dev`. El backend debe tener la dirección de este frontend en su variable `CORS_ORIGINS`.

Las variables `VITE_*` son públicas: ahí va solo la dirección del servidor, nunca claves ni la cadena de la base de datos.

### Alta de una agencia

1. El administrador entra, escribe el correo de la agencia y crea el acceso. El panel muestra una clave temporal una sola vez.
2. La agencia entra con ese correo y la clave temporal. La cuenta está «pendiente de registro» y solo puede abrir la pantalla de registro. Con el backend, la clave temporal vence a los siete días.
3. Allí define su propia clave (mínimo 8 caracteres) y los datos de su agencia espacial. Al guardar, la sesión temporal se cierra.
4. Desde entonces ingresa con su clave. La clave temporal deja de servir.

Desde el panel, el administrador también puede **corregir** el correo y los datos de una cuenta, **restablecer el acceso** de una agencia (vuelve a quedar pendiente, con otra clave temporal) y **eliminar** cuentas, salvo la suya.

### Sin backend (demostración)

Las cuentas se guardan en **este navegador**: cualquiera con acceso al equipo puede leerlas o cambiarlas, y las iniciales están a la vista en `src/data/demoAccounts.ts`. Sirve para probar los roles y el flujo de alta, **no para proteger información**.

| Cuenta | Rol | Clave | Al entrar |
| --- | --- | --- | --- |
| `donald@gmail.com` | Administrador | `12345` | Panel de usuarios (`#admin`) |
| `liskeyla@gmail.com` | Agencia | `12345` | Mundo interactivo (`#mundo`) |

### Dónde está cada cosa

- `src/services/auth.ts`: la interfaz que usan las pantallas (`AuthApi`) y la versión de demostración.
- `src/services/authHttp.ts`: la versión que habla con el backend.
- `src/services/session.ts`: elige una u otra y ofrece la sesión a las pantallas.
- `src/app/routes.ts`: qué pantalla puede ver cada sesión.
- Pruebas en `tests/auth.test.ts` y `tests/authHttp.test.ts` (esta última, contra un servidor simulado con el mismo contrato).

Ocultar una pantalla no protege nada por sí solo: los permisos de verdad los comprueba el servidor en cada consulta.

## Mundo interactivo

Un globo 3D que se gira arrastrando, se acerca con la rueda, el pellizco o los botones, y también se maneja con el teclado. Tres listas deciden qué se ve:

- **Mundo de referencia:** Luna (terreno real) o Marte (demostración con datos sintéticos).
- **Región lunar:** una de las veinte regiones, agrupadas en tres zonas: **polo sur** (las nueve candidatas de Artemis III), **polo norte** (cinco cráteres cercanos al polo) y **zona central** (seis accidentes de la cara visible, entre ellos los alunizajes del Apolo 11 y del Apolo 15). También se elige sobre un mapa real de cada zona, que se puede ampliar para ver todos los nombres.
- **Similitud:** Alta, Media o Baja, con un **porcentaje de coincidencia** de terreno entre el lugar y la región elegida: alta con 85 % o más, media de 60 a 84 % y baja con menos de 60 %. El porcentaje sale de la misma distancia que usa el ranking (ver [Método y límites](#método-y-límites)).

Según el acercamiento, el globo agrupa las localidades por continente, país, provincia o zona. Al elegir un marcador o un elemento de la lista, la cámara vuela hasta él y lo desglosa en el nivel siguiente; una zona abre su ficha, con los valores del lugar junto a los de la región lunar.

### El lugar de cerca

Al llegar al último nivel, el globo deja paso a un **mapa 3D del lugar**: imagen satelital sobre relieve real, con el recuadro de 18 km que se analizó. Se puede mover, girar, acercar y cambiar de capa:

| Capa | Fuente | Detalle |
| --- | --- | --- |
| Satélite | [Sentinel-2 cloudless 2016](https://s2maps.eu) de EOX (CC BY 4.0) | 10 m por píxel. No cubre la Antártida |
| Mapa | [OpenStreetMap](https://www.openstreetmap.org/copyright) | Caminos y nombres |
| Hoy desde el espacio | Imagen diaria MODIS/Terra de [NASA GIBS](https://www.earthdata.nasa.gov/engage/open-data-services-software/earthdata-developer-portal/gibs-api) | 250 m por píxel, de anteayer: nubes y nieve reales |
| Relieve 3D | Teselas Terrarium de Mapzen en [AWS Open Data](https://registry.opendata.aws/terrain-tiles/) | Exagerado ×1,5 en pantalla, y se indica |

El mapa usa [MapLibre GL JS](https://maplibre.org/), de código abierto, y se descarga solo al abrir el primer lugar. Ninguna capa pide clave; a esos servicios solo llegan las coordenadas de lo que se mira. Los créditos de cada capa se muestran junto al mapa (`src/features/world/placeEngine.ts`).

La ficha del lugar tiene cinco pestañas:

- **Terreno:** los valores del lugar junto a los de la región lunar, y **cómo se llega**: el aeropuerto, la carretera, el poblado y el hospital más cercanos, de OpenStreetMap, con su distancia en línea recta ([scripts/accesos/](scripts/accesos/calcular.py)).
- **Ruedas:** el mismo robot en la región lunar y en el lugar: cuánto se hunde la rueda, cuánto patina y hasta qué pendiente sube. Detalle en [Ruedas: la rueda sobre el suelo](#ruedas-la-rueda-sobre-el-suelo).
- **Clima:**
  - La **temporada**: clima típico de cada mes, la mejor época para ir y una valoración orientativa para trabajo de campo.
  - **Ahora, de verdad.** El recuadro «Ahora» no se fía solo del promedio: lo contrasta con la **lluvia que cayó en los últimos 30 días** (Open-Meteo) y avisa si hay **El Niño o La Niña** (índices de NOAA). En noviembre de 2026, Sierra Negra (Galápagos) es «temporada seca» en promedio, pero llovieron más de 400 mm con un El Niño muy fuerte: la ficha lo muestra como «Llueve mucho más de lo normal · Difícil».
  - El clima de ahora mismo (temperatura, viento, nubosidad).
  - La **temperatura del suelo** medida por satélite (MODIS, de día y de noche por trimestre) junto a la de la región lunar (radiómetro Diviner de NASA).
  - Detalle y límites en [scripts/clima/README.md](scripts/clima/README.md), [scripts/temperatura/README.md](scripts/temperatura/README.md) y [scripts/luna/README.md](scripts/luna/README.md).
- **Fotos:** la **lectura del terreno con IA** y, debajo, las fotos tomadas a menos de 10 km, de [Wikimedia Commons](https://commons.wikimedia.org/), cada una con su autor y su licencia, y enlaces para abrir el lugar en Google Maps y en OpenStreetMap. No es una selección revisada.
  - **Lectura del terreno con IA.** Un modelo que mira imágenes (Gemini) revisó las fotos reales de cada lugar y estimó qué cubre el suelo, cuántas rocas sueltas hay, de qué tamaño y cuánta vegetación. Llena un hueco de los datos: el relieve de 30 m no ve rocas.
    - Cada foto revisada queda como evidencia, con lo que la IA vio en ella.
    - Es una estimación en clases amplias, con una confianza que depende de cuántas fotos servían. Sin fotos que muestren el suelo no hay lectura.
    - El simulador la usa para decidir cuántas rocas pone y de qué tamaño. Detalle y límites en [scripts/fotos/README.md](scripts/fotos/README.md).
- **Turnos:** si el lugar se puede reservar, los días ya ocupados y el formulario para reservar. Detalle en [Portal de turnos](#portal-de-turnos).

### Ruedas: la rueda sobre el suelo

La pestaña **Ruedas** compara cómo se comportaría la rueda de un vehículo lunar en la región de la Luna y en el lugar de la Tierra: el hundimiento, el patinaje en cada pendiente y la pendiente más fuerte que sube con hasta un 40 % de patinaje (el requisito de VIPER y el límite que usa el equipo de Curiosity). Responde a la pregunta central: **¿sirve este lugar para probar ruedas que irán a la Luna?**

- **Modelo:** el clásico de rueda rígida sobre suelo deformable (Bekker, Janosi y Hanamoto, Wong y Reece), en `src/features/mission/terramechanics.ts`. Se calcula en un worker para no trabar la pantalla.
- **Vehículos:** VIPER (447 kg, ruedas de 50 × 20 cm) y el carro lunar del Apolo (708 kg cargado, ruedas de 81,8 × 23 cm), con sus fuentes en `src/features/mission/wheelData.ts`. En el simulador del centro de misión se suman Perseverance (1025 kg, seis ruedas de 52,5 × 33,6 cm; el ancho está medido en el modelo 3D oficial de NASA) y Curiosity (899 kg, seis ruedas de 50 × 40 cm).
- **Suelo lunar:** la estimación de las sondas Surveyor que recomienda el Lunar Sourcebook. Nunca se midió en la Luna con un bevámetro.
- **Suelo de aquí:** tipos de suelo con parámetros publicados (Wong, 2001) y el simulante lunar GRC-3 de NASA. El suelo sugerido sale de la textura del mapa mundial SoilGrids, que es una predicción y no una medición; se puede cambiar.
- **Comprobación:**
  - Con el carro lunar del Apolo 15, el cálculo da 2,1 cm de hundimiento y 3 % de patinaje; en la Luna se midieron unos 1,25 cm y entre 2 y 3 %. Da una pendiente máxima de unos 20°; el Apolo registró entre 19 y 23°.
  - Frente a la versión aligerada de VIPER en el laboratorio SLOPE de NASA, el cálculo es conservador: se atasca unos 6° antes, porque no modela los tacos de la rueda.
- **Límites:**
  - Es un modelo empírico y no recoge cómo la gravedad baja debilita el suelo granular. Un estudio con NASA (Hu y otros, 2025) muestra que por eso las pruebas en la Tierra con robots aligerados resultan demasiado optimistas, y recomienda probar con la masa real.
  - La rueda se trata como lisa y rígida.
  - Con hundimientos de más de un tercio del radio, la pantalla avisa de que el cálculo pierde precisión.

Para actualizar el suelo sugerido: `python scripts/suelo/calcular.py` (unos 8 minutos, porque el servicio admite 5 consultas por minuto). Escribe `src/data/sueloReal.json`.

### Centro de misión

El botón **Planificar una campaña aquí** abre cinco herramientas para ese lugar (`src/features/mission/`):

- **Gemelo digital.** Descarga el relieve real de los 18 km como malla 3D (`.obj`, en metros, con Z hacia arriba y sin exagerar) y como paquete de simulación (`.json`, con el mapa de alturas, las pendientes y la gravedad lunar). Tres resoluciones: 64, 128 o 256 celdas por lado. Sirve para probar un robot en Gazebo, Isaac Sim, Unity o Blender antes de viajar. **La fricción, la cohesión y la densidad del suelo van vacías**: no hay ensayos de campo y no se inventan.
- **Prueba del robot.** Un simulador 3D a pantalla completa que responde a dónde colocar el robot y qué le pasaría antes de viajar. Al abrir la pestaña, el centro de misión ocupa toda la ventana y nada se desplaza: los mandos van sobre la imagen.
  - **Dónde colocarlo:** reparte el área de 18 km en cuadros de 3 km y sugiere los 3 con más coincidencia de terreno con la región lunar, con la misma receta que la comparación entre lugares (`spots.ts`). También se puede poner en otro sitio.
  - **Qué robot:** un catálogo con la clasificación del catálogo técnico del equipo (operativo, planificado, prototipo) y sus fuentes de NASA y JPL (`robots.ts`, `RobotCatalog.tsx`).
    - Se pueden conducir **Perseverance**, **Curiosity**, **VIPER** y el **carro lunar del Apolo** (referencia histórica): son los que tienen publicadas la masa y las ruedas.
    - **CADRE**, **DuAxel** y **EELS** aparecen con el motivo por el que no se simulan (masa o ruedas sin publicar, o no tienen ruedas). Lo que falta no se inventa.
    - Perseverance y Curiosity usan el **modelo 3D oficial de NASA** (cortesía de NASA/JPL-Caltech), aligerado con `scripts/modelos/aligerar.py` sin tocar su geometría. VIPER y el carro lunar no tienen modelo oficial: llevan una forma simplificada con sus medidas publicadas, y la pantalla lo dice. NASA no avala este proyecto.
    - Los robots de Marte se prueban aquí con la gravedad de la Tierra. La comparación «Luna frente a aquí» de la pestaña Ruedas sigue siendo solo para vehículos lunares.
  - **Conducir como en un videojuego:** flechas o W A S D para avanzar, girar y retroceder; C cambia la cámara (seguir, libre, cenital, área); R reinicia. Un clic en el terreno pone una bandera y el robot va solo. En pantallas táctiles aparecen mandos en pantalla.
  - **La física sigue siendo el modelo rueda-suelo:** en cada paso, la pendiente bajo el robot se convierte en patinaje, hundimiento y par (`drive.ts`). Si la tabla dice que se atasca, se atasca. El tiempo se acelera (×1 a ×200) para que se pueda conducir un robot que avanza a centímetros por segundo; los resultados van siempre en unidades reales.
  - **El relieve real, completo:** los 18 km del área a 30 m y sin exagerar, con la imagen Sentinel-2. Si el lugar es un volcán, se ve el volcán entero (Sierra Negra con su caldera, el Etna, el Cotopaxi). Hay capas de pendiente y de curvas de nivel.
  - **El cielo de verdad:** el sol está donde está a esa hora en el lugar (si allí es de noche, se usa la luz de la mañana y se avisa, con un botón para ver la noche real con faros) y el tiempo es el de ahora mismo según Open-Meteo: nubes, niebla, lluvia o nieve, y viento.
  - **Base y rocas con las que se choca:** una base de campaña (módulos, antena, paneles, cajas) y rocas alrededor del punto de salida. El robot se detiene al toparlas y los topes se cuentan.
  - **En pantalla:** estado, pendiente, patinaje aquí y el que tendría en la Luna, hundimiento, velocidad real, recorrido, tiempo real, energía y topes.
  - **Al plan de campaña:** el resultado (llegó al destino, se atascó o recorrido libre) se añade con las coordenadas de inicio y final.
  - **Qué es real y qué es ilustrativo**, tal como lo dice la pantalla:
    - Real: el relieve, el color del suelo (satélite a 10 m), la posición del sol, el tiempo de ahora y los números del modelo rueda-suelo.
    - Ilustrativo: las rocas, la base, el grano fino del suelo y la forma de las nubes y de la lluvia. Los datos de 30 m no ven rocas.
  - **Límites:**
    - Bajando, el modelo no calcula el frenado y usa los valores del llano.
    - La suspensión no se articula: el cuerpo se inclina como una pieza.
    - Con su masa real, VIPER se atasca hacia los 3,5° en arena seca. Es lo que da el modelo, que es conservador (no cuenta los tacos de la rueda); con suelo franco arenoso avanza.
    - La prueba usa la masa real del robot, como recomienda el estudio con NASA de 2025.
- **Costo desde tu ubicación.** Calcula la distancia real desde el punto de salida (una ciudad de la lista o la ubicación del navegador, que solo se pide al pulsar el botón y no sale del equipo) y estima pasajes, carga, trabajo de campo, permisos e imprevistos. **Las tarifas son supuestos de ejemplo** que se pueden cambiar en la pantalla: sirven para comparar lugares, no son cotizaciones.
- **Ventana y plan.** Resume el clima típico en cuatro trimestres (óptima, exigente o restringida) y genera un plan de campaña con un código, descargable en `.txt` o `.json`. El plan es un documento de planificación. Debajo aparece el formulario para **reservar el turno** de ese plan, ya rellenado con sus fechas, sus días y su robot.
- **Copiloto IA.** Explica el lugar en lenguaje llano, responde preguntas («¿conviene ir ahora?», «¿qué permisos necesito?») y redacta el resumen ejecutivo del plan, que se puede copiar o descargar.
  - Lo escribe un modelo de IA de Google (Gemini) a través del backend, que guarda la clave. Sin servidor no hay copiloto, y la pantalla lo explica.
  - La IA recibe solo los datos que ya están en pantalla: terreno, clima de ahora, El Niño, temperatura del suelo, suelo, turnos, la prueba del robot y el plan (`src/features/ai/context.ts`). No se envían el correo, el nombre ni la institución de quien pregunta.
  - **La IA explica y redacta; no calcula.** No decide la coincidencia, el clima, las ruedas ni si un lugar está protegido: eso sale siempre de los datos. Cada respuesta lleva el aviso de que puede equivocarse.

### Portal de turnos

Una agencia reserva un lugar para un rango de días; el turno queda guardado en la base de datos del backend (`src/features/turnos/`, `src/services/turnos*.ts`).

- **Reservar:** desde la pestaña «Turnos» de un lugar o desde el plan del centro de misión. Si el lugar está libre en esas fechas, el turno queda reservado al instante. Si otra agencia ya lo tiene, sale **«Ocupado»** con los días en conflicto y la primera fecha libre; nunca se dice qué agencia es.
- **Mis turnos:** la lista de la agencia (próximo, en curso, terminado o cancelado), con el motivo si lo canceló el administrador.
- **Áreas protegidas.** Cada lugar se consulta en la base mundial de áreas protegidas (WDPCA, de UNEP-WCMC y la UICN). No se inventa nada: es lo que declara cada país.
  - Dentro de un área de **protección estricta** (categorías Ia a IV de la UICN, como un parque nacional): **no se puede reservar**, y la agencia ve el nombre del área, su categoría y su autoridad. Hoy son 11 de los 37 lugares, entre ellos Sierra Negra (Parque Nacional Galápagos), el Páramo del Cotopaxi y el Etna.
  - Dentro de un área de **uso múltiple** (categorías V y VI) o sin categoría informada: se reserva **declarando el permiso** de la autoridad del área. Son 7, entre ellos el Arenal del Chimborazo.
  - Sin área protegida en el punto: se reserva. Son 19.
  - La regla es un criterio de PROMETHEUS apoyado en las categorías de la UICN, no un dictamen legal, y la base puede estar incompleta. Detalle y límites en [scripts/protegidas/README.md](scripts/protegidas/README.md).
- **Administrador:** su pantalla tiene tres pestañas. **Cuentas** (lo de siempre), **Turnos** (todos los turnos con su agencia, filtros, contadores y cancelar con motivo) y **Lugares** (qué dice la base de cada lugar; puede cerrar uno, por ejemplo por una erupción, o habilitar uno bloqueado cuando la agencia presenta el permiso, siempre con un motivo que la agencia ve).
- **El servidor decide.** Las reglas se comprueban en el backend con su propia copia del catálogo; el navegador solo las muestra. Dos reservas simultáneas del mismo lugar nunca entran las dos.
- **Sin backend,** la demostración guarda los turnos en el navegador con las mismas reglas.
- **Un turno coordina a las agencias de este portal.** No reemplaza los permisos del país, del dueño del terreno ni de la autoridad de un área protegida, y la pantalla lo dice.

### Terreno real: Luna y Tierra

Con la Luna, los dos lados de la comparación son mediciones:

| | Fuente | Resolución |
| --- | --- | --- |
| Luna, polo sur | Elevación LOLA, [NASA GSFC PGDA](https://pgda.gsfc.nasa.gov/products/90) (Barker et al. 2023, [doi:10.3847/PSJ/acf3e1](https://doi.org/10.3847/PSJ/acf3e1)) | 30 m |
| Luna, polo norte | LOLA Gridded Data Record, [NASA PDS](https://pds-geosciences.wustl.edu/missions/lro/lola.htm) | 30 m |
| Luna, zona central | SLDEM2015 (LOLA + cámara de Kaguya), [NASA PDS](https://pds-geosciences.wustl.edu/missions/lro/lola.htm) (Barker et al. 2016, [doi:10.1016/j.icarus.2015.07.039](https://doi.org/10.1016/j.icarus.2015.07.039)) | 60 m |
| Tierra | [Copernicus DEM](https://registry.opendata.aws/copernicus-dem/) GLO-30, sin las superficies de agua | 30 m, y promediado a 60 m para la zona central |
| Regiones del polo sur | Las nueve candidatas de [Artemis III](https://www.nasa.gov/news-release/nasa-provides-update-on-artemis-iii-moon-landing-regions/) (NASA, 28 de octubre de 2024) | — |
| Regiones del polo norte y de la zona central | Recuadros de 21 km centrados en accidentes con nombre del [nomenclátor IAU/USGS](https://planetarynames.wr.usgs.gov/) | — |
| Temperatura del suelo de cada lugar | MODIS, temperatura de la superficie (LST) de día y de noche por trimestre; detalle en [scripts/temperatura/](scripts/temperatura/README.md) | 1 km |
| Temperatura del suelo de cada región lunar | Radiómetro Diviner de LRO, [NASA PDS](https://pds-geosciences.wustl.edu/lro/urn-nasa-pds-lro_diviner_derived1/data_derived_gcp/) (Williams y otros, 2017); detalle en [scripts/luna/](scripts/luna/README.md) | 0,5° |
| Búsqueda amplia de zonas nuevas | [ETOPO 2022](https://www.ncei.noaa.gov/products/etopo-global-relief-model) de NOAA frente a LOLA LDEM_64, con la lluvia anual de WorldClim 2.1; detalle en [scripts/buscador/](scripts/buscador/README.md) | unos 470 m |
| Rugosidad fina de cada región lunar | Láser LOLA, producto LDRM_32_50 (mediana de la variación de altura entre puntos a 25 m), [NASA PDS](https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/cylindrical/float_img/); detalle en [scripts/luna/](scripts/luna/README.md) | unos 950 m por píxel |

En ambos cuerpos se aplica la misma receta, que sigue la definición del backend (`prometheus_topography_plane_v1`): ventanas de 3 km sobre una malla métrica y, por ventana, **relieve** (máximo − mínimo), **pendiente** media y **rugosidad** (RMS respecto a un plano ajustado). Cada región lunar se resume con la mediana de las ventanas de su recuadro, y cada lugar terrestre con la mediana de 36 ventanas en un área de 18 km alrededor de su coordenada. **La Tierra se compara siempre a la misma resolución que la zona lunar**: a 30 m con los polos y a 60 m con la zona central, donde la mejor elevación disponible es más gruesa.

Lo que hay que saber antes de interpretar el resultado:

- **Solo compara la forma del terreno.** Ningún lugar de la Tierra reproduce el vacío, la gravedad lunar, la radiación ni las temperaturas del polo sur; eso se ensaya en instalaciones, no en el terreno.
- **La coincidencia es de terreno, nada más.** El porcentaje dice cuánto se parecen esos tres descriptores (100 % es el mismo relieve, pendiente y rugosidad). No es una probabilidad ni una nota del lugar: no cuenta el suelo, el clima ni el acceso.
- **Las regiones del polo sur están ubicadas de forma aproximada.** La NASA publicó un mapa, no coordenadas. Los recuadros se midieron sobre ese mapa (ver `scripts/terreno/regiones_luna.json`) y se comprobaron con los cráteres del nomenclátor IAU/USGS; el error es del orden de 1 km.
- **Fuera del polo sur no hay regiones candidatas publicadas.** Las del polo norte y de la zona central son recuadros de 21 km alrededor del centro de un accidente con nombre. Sirven de referencia; no son sitios propuestos por ninguna agencia.
- **Parte de la elevación lunar es interpolada.** En el polo sur, entre el 55 % y el 95 % de los píxeles de cada región tiene una medición directa de LOLA; el mapa lunar lo indica por región, y la pendiente calculada coincide con la que publica el propio producto (diferencia menor de 0,1°). Los productos del polo norte y de la zona central no traen ese dato.
- **Una distancia a 60 m no se compara con una a 30 m.** A menor resolución el terreno se ve más suave, en la Luna y en la Tierra por igual. Los resultados de la zona central se leen entre sí, no contra los de los polos.
- **Copernicus es un modelo de superficie:** incluye vegetación y edificios. En desiertos y volcanes apenas influye.
- **La lista de lugares es inicial.** Son 37 lugares elegidos a mano. Para las regiones más abruptas del polo sur (Malapert Massif, Nobile Rim 1, el pico junto a Cabeus B) ninguno tiene similitud alta, y la pantalla lo dice. Las llanuras, como el fondo del cráter Peary o el mar donde alunizó el Apolo 11, encuentran muchos.
- **Más allá de la lista hay una búsqueda amplia, a escala gruesa.** La tarjeta de cada región lunar ofrece 5 zonas nuevas por explorar: salen de recorrer el relieve mundial ETOPO 2022 (228 000 bloques de unos 16 km entre 15° S y 45° N) y quedarse con las zonas áridas más parecidas, lejos de los lugares de la lista. Compara a unos 470 m, no a 30 m, y no revisa clima, suelo, accesos ni áreas protegidas: son puntos de partida, y la pantalla lo dice. Detalle en [scripts/buscador/README.md](scripts/buscador/README.md).
- **Un lugar sin datos no se rellena.** El Salar de Uyuni queda fuera porque el modelo de elevación lo marca como agua.

Archivos:

- `src/features/world/places.json`: la lista de lugares (continente, país, provincia, zona y coordenadas). **Aquí se añaden lugares nuevos.** Su campo `demo` son descriptores sintéticos que solo usa Marte.
- `scripts/terreno/`: el cálculo, en Python. Tras añadir o mover un lugar hay que ejecutarlo de nuevo; una prueba avisa si se olvida. Instrucciones en [scripts/terreno/README.md](scripts/terreno/README.md).
- `src/data/terrenoReal.json` y los tres mapas lunares de `src/features/world/` (`polo-sur-lunar.webp`, `polo-norte-lunar.webp`, `zona-central-lunar.webp`): lo que genera el cálculo. No se editan a mano.
- `src/features/world/lunar.ts`: regiones lunares y lugares medidos, tal como los usa la pantalla.
- `src/features/world/hierarchy.ts`: similitud, porcentaje de coincidencia y desglose, con pruebas en `tests/world.test.ts`.
- `src/features/world/globe.ts`: el globo y la navegación.

La ficha de cada zona muestra el **clima actual real** del lugar (temperatura, sensación, humedad, viento, nubosidad, precipitación y presión) desde [Open-Meteo](https://open-meteo.com/), un servicio gratuito y sin clave para uso no comercial (hasta 10 000 consultas al día), con datos bajo CC BY 4.0 que exigen citar la fuente. Cada consulta se reutiliza 10 minutos. El cliente está en `src/services/weather.ts`; para uso comercial hace falta un plan de pago de Open-Meteo. La ficha también enlaza el lugar en OpenStreetMap.

Las costas y fronteras provienen de [Natural Earth](https://www.naturalearthdata.com/) a escala 1:50m, de dominio público, mediante el paquete `world-atlas`. Los colores del terreno y las nubes son ilustrativos. Sin WebGL, el desglose sigue disponible desde la lista.

## Método y límites

Distancia = promedio de diferencias absolutas escaladas: relieve / 1000 m, pendiente / 15° y rugosidad / 100 m. Pesos iguales y escalas ilustrativas, compatibles con la fórmula del MVP Python. Menor es más próximo en esos descriptores. Los empates comparten posición.

**Coincidencia** = 100 × (1 − distancia), redondeada y nunca menor que 0. Así, 100 % es la misma forma de terreno y cada punto que baja es una centésima de distancia; una distancia de 1 (diferir a la vez 1000 m de relieve, 15° de pendiente y 100 m de rugosidad) ya es 0 %. La similitud es **alta** con 85 % o más, **media** de 60 a 84 % y **baja** con menos de 60 % (`src/features/world/hierarchy.ts`). No es una probabilidad y no compara clima, geología ni habitabilidad.

## Backend

El proyecto [velkaris-prometheus](https://github.com/SuperGallinazo27/velkaris-prometheus) se mantiene separado. Es una API en FastAPI con base de datos PostgreSQL. Este frontend usa de él las **cuentas y la sesión** (ver [Cuentas y acceso](#cuentas-y-acceso)), los **turnos**, el **copiloto de IA** y el **índice de El Niño**; el análisis de terreno todavía se hace con los datos de este repositorio. Detalles en [docs/backend-integration.md](docs/backend-integration.md). `.env.example` muestra la única variable necesaria, sin secretos.
