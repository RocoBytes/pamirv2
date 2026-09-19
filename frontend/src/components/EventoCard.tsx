import { Calendar, Clock, MapPin, Megaphone, Mountain, UserRound, Users } from 'lucide-react'
import type { EventoListItem } from '../types/evento'
import {
  ESTADO_VISIBLE_COLORS,
  categoriaChipStyle,
  deriveEstadoVisible,
  formatCorteSantiago,
  formatRangoFechas,
} from '../types/evento'

interface EventoCardProps {
  evento: EventoListItem
  onClick: (id: string) => void
}

export function EventoCard({ evento, onClick }: EventoCardProps) {
  const visible = deriveEstadoVisible(evento)
  const rango = formatRangoFechas(evento.fechaInicio, evento.fechaFin)
  // Borradores y cancelados (solo los ve el admin en la lista) van atenuados
  const muted = evento.estado === 'BORRADOR' || evento.estado === 'CANCELADO'

  return (
    <button
      onClick={() => onClick(evento.id)}
      className={[
        'w-full text-left bg-white rounded-2xl border border-[#4a6fad]/15 shadow-sm hover:shadow-md',
        'transition-shadow duration-200 overflow-hidden',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#264c99]',
        muted ? 'opacity-70' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {evento.avisoDestacado && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-1.5 flex items-center gap-1.5 text-xs font-semibold text-amber-800">
          <Megaphone size={13} className="shrink-0" />
          <span className="truncate">{evento.avisoDestacado}</span>
        </div>
      )}

      <div className="p-4 sm:p-5">
        <div className="flex items-center gap-2 flex-wrap mb-2">
          {evento.categoria && (
            <span
              className="shrink-0 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md"
              style={categoriaChipStyle(evento.categoria.color, 'tint')}
            >
              {evento.categoria.nombre}
            </span>
          )}
          <span
            className={`text-xs font-semibold px-2.5 py-1 rounded-full ${ESTADO_VISIBLE_COLORS[visible.tone]}`}
          >
            {visible.badge}
          </span>
          {evento.miInscripcion?.estado === 'POSTULADO' && (
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#264c99] bg-[#e8eef7] border border-[#264c99]/20 px-2 py-0.5 rounded-md">
              Postulado/a
            </span>
          )}
        </div>

        <h3 className="font-semibold text-slate-900 text-base leading-tight mb-3">
          {evento.titulo}
        </h3>

        <div className="grid gap-1.5 text-xs text-[#757874]">
          {rango && (
            <div className="flex items-center gap-1.5">
              <Calendar size={13} className="text-[#757874]/60 shrink-0" />
              <span>
                {rango}
                {evento.duracionTexto && ` · ${evento.duracionTexto}`}
              </span>
            </div>
          )}
          {evento.ubicacion && (
            <div className="flex items-center gap-1.5">
              <MapPin size={13} className="text-[#757874]/60 shrink-0" />
              <span className="truncate">{evento.ubicacion}</span>
            </div>
          )}
          {evento.alturaMaximaMsnm !== null && (
            <div className="flex items-center gap-1.5">
              <Mountain size={13} className="text-[#757874]/60 shrink-0" />
              <span>{evento.alturaMaximaMsnm.toLocaleString('es-CL')} msnm</span>
            </div>
          )}
          {evento.organizadorNombre && (
            <div className="flex items-center gap-1.5">
              <UserRound size={13} className="text-[#757874]/60 shrink-0" />
              <span className="truncate">{evento.organizadorNombre}</span>
            </div>
          )}
          {evento.cupos !== null && (
            <div className="flex items-center gap-1.5">
              <Users size={13} className="text-[#757874]/60 shrink-0" />
              <span className="font-medium text-[#4a6fad]">
                {evento.cupos} cupos · {evento.totalPostulantes}{' '}
                {evento.totalPostulantes === 1 ? 'postulante' : 'postulantes'}
              </span>
            </div>
          )}
          {visible.tone === 'open' && evento.fechaCorte && (
            <div className="flex items-center gap-1.5">
              <Clock size={13} className="text-[#757874]/60 shrink-0" />
              <span>Inscripciones hasta {formatCorteSantiago(new Date(evento.fechaCorte))}</span>
            </div>
          )}
        </div>
      </div>
    </button>
  )
}
