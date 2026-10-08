import type { ReactNode } from 'react'

// Tarjeta centrada de las pantallas de error a página completa; el mensaje se
// anuncia como alerta y las acciones van debajo, una por fila.
export function ErrorCard({ message, children }: { message: string; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-alpine-canvas flex items-center justify-center px-4">
      <div
        role="alert"
        className="max-w-sm w-full bg-white rounded-2xl shadow-sm border border-secondary/15 p-6 text-center"
      >
        <p className="text-sm text-slate-700 mb-5">{message}</p>
        <div className="flex flex-col gap-2">{children}</div>
      </div>
    </div>
  )
}
