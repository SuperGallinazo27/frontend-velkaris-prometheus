# PROMETHEUS · Frontend VELKARIS

Interfaz independiente para explorar análogos planetarios, comparar candidatos terrestres y experimentar con módulos de riesgos y economía. React + TypeScript + Vite, gestionado con Bun.

> **DEMOSTRACIÓN:** todos los descriptores, niveles de riesgo y supuestos económicos son sintéticos. Los nombres geográficos son referencias; las coordenadas son aproximadas y el mapa es esquemático. No contiene datos NASA, IA entrenada, validación científica ni predicción de anomalías solares o geomagnéticas.

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

Necesitas internet para descargar las herramientas y dependencias. Para esta demo no necesitas Python, una cuenta NASA, claves API ni configurar un archivo `.env`.

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

- Tres escenarios marcianos y tres candidatos terrestres sintéticos.
- Mapa vectorial esquemático con selección de candidato y ficha de descriptores.
- Ranking recalculado al cambiar de región, búsqueda y exportación CSV etiquetada como demo.
- Matriz de riesgos ficticia, explícitamente sin evaluación real.
- Calculadora de presupuesto terrestre con duración, equipo, tarifa, logística y contingencia ajustables.
- Navegación por teclado, etiquetas accesibles y diseño adaptable a móvil.

## Estructura editable

```text
src/
  app/                  # Composición y navegación
  components/           # Elementos compartidos
  data/                 # Datos sintéticos con comentarios de procedencia
  features/
    explore/            # Mapa y selección
    ranking/            # Distancia entre descriptores
    economy/            # Calculadora y reglas
  services/             # Punto de extensión para API
  styles/               # Diseño adaptable
  types/                # Contratos TypeScript
tests/                  # Pruebas del dominio
docs/                   # Integración futura
public/                 # Recursos públicos
```

Los archivos fuente se pueden editar directamente en GitHub o localmente. `node_modules` y `dist` están excluidos. El build genera un sitio estático; publicar el repositorio no equivale a desplegar el sitio. Para alojarlo bajo una subcarpeta, configura `base` en `vite.config.ts`.

## Método y límites

Distancia = promedio de diferencias absolutas escaladas: relieve / 1000 m, pendiente / 15° y rugosidad / 100 m. Pesos iguales y escalas ilustrativas, compatibles con la fórmula del MVP Python. Menor es más próximo en esos descriptores. Los empates comparten posición. No es un porcentaje ni una probabilidad y no compara clima, geología o habitabilidad.

Riesgos: valores ficticios constantes, independientes de la región. Economía: `personas × días × tarifa diaria + logística`, más contingencia porcentual. No incluye impuestos, seguros, permisos ni equipamiento especializado; no estima misiones espaciales.

## Backend existente

El proyecto [velkaris-prometheus](https://github.com/SuperGallinazo27/velkaris-prometheus) se mantiene separado. Actualmente es Python/Streamlit; este frontend no se conecta a una API activa. La propuesta y sus requisitos están en [docs/backend-integration.md](docs/backend-integration.md). `.env.example` reserva la futura configuración sin secretos.
