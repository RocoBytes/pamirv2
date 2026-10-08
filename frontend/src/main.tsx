import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Las pantallas lazy de App.tsx viajan en chunks con hash. Una pestaña abierta
// ANTES de un deploy todavía pide los hashes viejos, que ya no existen
// (nginx responde 404 en /assets/): Vite avisa con `vite:preloadError`. Se
// recarga una vez para traer el index.html nuevo; si ya se recargó hace poco
// (sin red, o un asset realmente roto) se deja pasar el error en vez de
// entrar en un bucle de recargas.
const PRELOAD_RELOAD_KEY = 'riala_preload_reload_at'
window.addEventListener('vite:preloadError', (event) => {
  try {
    const last = Number(sessionStorage.getItem(PRELOAD_RELOAD_KEY) ?? 0)
    if (Date.now() - last < 10_000) return
    sessionStorage.setItem(PRELOAD_RELOAD_KEY, String(Date.now()))
  } catch {
    return // sin sessionStorage no hay cómo evitar el bucle: mejor mostrar el error
  }
  event.preventDefault()
  window.location.reload()
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
