import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
  build: {
    rolldownOptions: {
      output: {
        // Cada grupo captura SOLO los módulos que coinciden con su `test`: lo
        // que no coincide con ningún grupo lo reparte el chunking automático
        // según quién lo importa (las pantallas lazy de App.tsx quedan cada
        // una en su propio chunk). Los patrones son de paquete exacto, no de
        // prefijo: `node_modules/react` también atrapaba react-grid-layout,
        // react-redux, etc. y los metía en el chunk de entrada.
        codeSplitting: {
          groups: [
            { name: 'vendor', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
            { name: 'forms', test: /node_modules[\\/](react-hook-form|zod|@hookform)[\\/]/ },
            { name: 'icons', test: /node_modules[\\/]lucide-react[\\/]/ },
            { name: 'motion', test: /node_modules[\\/](motion|motion-dom|motion-utils|framer-motion)[\\/]/ },
            // recharts y TODO lo que trae consigo (d3, redux toolkit, immer,
            // decimal.js, ...): ~380 kB que solo usa el AdminDashboard, que es
            // lazy. Un paquete nuevo en esta cadena no rompe nada: si no está
            // en la lista queda en el chunk del AdminDashboard, nunca en el
            // de entrada.
            {
              name: 'charts',
              test: /node_modules[\\/](recharts|@reduxjs|@standard-schema|d3-[^\\/]+|decimal\.js-light|es-toolkit|eventemitter3|immer|internmap|react-redux|redux|redux-thunk|reselect|tiny-invariant|use-sync-external-store|victory-vendor)[\\/]/,
            },
          ],
        },
      },
    },
  },
})
