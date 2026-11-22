import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/**
 * El control por gestos usa MediaPipe, que carga su motor (WebAssembly) desde una carpeta pública.
 * El motor viene en el paquete de npm: se copia a `public/mediapipe/wasm/` al arrancar Vite (en
 * desarrollo y al compilar), para no guardar 15 MB repetidos en el repositorio. El modelo de
 * gestos (`public/mediapipe/gesture_recognizer.task`) sí está en el repositorio: no viene en npm.
 */
function copyGestureEngine() {
  const root = dirname(fileURLToPath(import.meta.url))
  const from = join(root, 'node_modules/@mediapipe/tasks-vision/wasm')
  const to = join(root, 'public/mediapipe/wasm')
  if (!existsSync(from)) return // sin dependencias instaladas, Vite ya avisará de lo que falta
  mkdirSync(to, { recursive: true })
  for (const file of ['vision_wasm_internal.js', 'vision_wasm_internal.wasm']) {
    const source = join(from, file)
    const target = join(to, file)
    if (!existsSync(target) || statSync(target).size !== statSync(source).size) copyFileSync(source, target)
  }
}
copyGestureEngine()

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // MapLibre crea su trabajador como módulo; el formato por defecto (iife) no lo admite.
  worker: { format: 'es' },
  build: {
    // La escena 3D (Three.js) y el mapa del lugar (MapLibre) van en archivos propios, bajo demanda.
    chunkSizeWarningLimit: 1100,
  },
})
