import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

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
