# PROMETHEUS · Frontend VELKARIS

Interfaz independiente para explorar análogos planetarios, comparar candidatos terrestres y experimentar con módulos de riesgos y economía. React + TypeScript + Vite, gestionado con Bun.

> **DEMOSTRACIÓN:** todos los descriptores, niveles de riesgo y supuestos económicos son sintéticos. Los nombres geográficos son referencias; las coordenadas son aproximadas y el mapa es esquemático. No contiene datos NASA, IA entrenada, validación científica ni predicción de anomalías solares o geomagnéticas.

## Requisitos

- [Bun](https://bun.sh/docs/installation) 1.4.4 o posterior (versión fijada para CI: 1.4.4).
- [Node.js](https://nodejs.org/) 22.12 o posterior para las herramientas de Vite; ver [requisitos oficiales](https://vite.dev/guide/).
- Git y un navegador moderno. Internet para la instalación; la interfaz no depende de servicios externos.

## Empezar

```bash
git clone https://github.com/SuperGallinazo27/frontend-velkaris-prometheus.git
cd frontend-velkaris-prometheus
bun install
bun dev
```

Abre la dirección que muestre Vite, normalmente `http://localhost:5173`. Para detener el servidor: Ctrl+C.

```bash
bun run build  # TypeScript + compilación de producción en dist/
bun run preview  # Vista local del resultado de producción
bun test  # Reglas de ranking y cálculo de presupuesto
```

`bun.lock` fija las dependencias. Para una instalación reproducible usa `bun install --frozen-lockfile`. `private: true` en package.json previene publicar accidentalmente en npm; no determina la visibilidad del repositorio en GitHub.

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
