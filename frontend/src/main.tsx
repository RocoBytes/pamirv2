import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { claimAutoReload } from './lib/preload-recovery'

// Las pantallas lazy de App.tsx viajan en chunks con hash. Una pestaña abierta
// ANTES de un deploy todavía pide los hashes viejos, que ya no existen
// (nginx responde 404 en /assets/): Vite avisa con `vite:preloadError`. Con red
// se recarga una vez para traer el index.html nuevo. Sin red NO: recargar
// reemplazaría la app en marcha por la página de "sin conexión" del navegador y
// perdería el estado, sin traer nada. En los demás casos se deja pasar el error,
// que atrapa el LazyScreen de la pantalla. La decisión vive en lib/preload-recovery.
window.addEventListener('vite:preloadError', (event) => {
  const reload = claimAutoReload({
    now: Date.now(),
    online: navigator.onLine,
    getStorage: () => window.sessionStorage,
  })
  if (!reload) return
  event.preventDefault()
  window.location.reload()
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
