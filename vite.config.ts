import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // La escena 3D de la portada (Three.js) va en su propio archivo y se carga bajo demanda.
    chunkSizeWarningLimit: 600,
  },
})
