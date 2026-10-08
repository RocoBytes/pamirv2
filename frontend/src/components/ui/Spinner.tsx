// Pantalla de carga a página completa: la de la carga inicial de la sesión y la
// de una pantalla lazy mientras llega su chunk.
export function Spinner() {
  return (
    <div className="min-h-screen bg-alpine-canvas flex items-center justify-center">
      <div className="flex flex-col items-center gap-3 text-slate-500">
        <div className="w-8 h-8 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin" />
        <p className="text-sm">Cargando...</p>
      </div>
    </div>
  )
}
