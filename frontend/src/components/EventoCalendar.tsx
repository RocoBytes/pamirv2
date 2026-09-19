import type { EventoListItem } from '../types/evento'
import { categoriaChipStyle, formatRangoFechas } from '../types/evento'

interface EventoCalendarProps {
  eventos: EventoListItem[]
  /** Mes visible, 'YYYY-MM'. */
  mes: string
  onSelect: (id: string) => void
}

const DIAS_LARGO = ['LUNES', 'MARTES', 'MIÉRCOLES', 'JUEVES', 'VIERNES', 'SÁBADO', 'DOMINGO']
const DIAS_CORTO = ['L', 'M', 'X', 'J', 'V', 'S', 'D']
const COLOR_SIN_CATEGORIA = '#264c99'

interface DiaCelda {
  key: string // 'YYYY-MM-DD'
  dia: number
  delMes: boolean
}

// Clave 'YYYY-MM-DD' vía aritmética de calendario en UTC. La aritmética usa
// Date.UTC internamente, pero todo posicionamiento/comparación es de strings.
function claveDia(anio: number, mesNum: number, dia: number): string {
  return new Date(Date.UTC(anio, mesNum - 1, dia)).toISOString().slice(0, 10)
}

// Semanas del mes con lunes como primer día (celdas de meses vecinos en gris)
function construirSemanas(mes: string): DiaCelda[][] {
  const [anio = 0, mesNum = 1] = mes.split('-').map(Number)
  const diasEnMes = new Date(Date.UTC(anio, mesNum, 0)).getUTCDate()
  const dowPrimero = new Date(Date.UTC(anio, mesNum - 1, 1)).getUTCDay() // 0=domingo
  const previos = (dowPrimero + 6) % 7 // celdas del mes anterior (lunes-first)
  const totalCeldas = Math.ceil((previos + diasEnMes) / 7) * 7

  const celdas: DiaCelda[] = []
  for (let i = 0; i < totalCeldas; i++) {
    const diaOffset = i - previos + 1
    const key = claveDia(anio, mesNum, diaOffset)
    celdas.push({
      key,
      dia: Number(key.slice(8, 10)),
      delMes: diaOffset >= 1 && diaOffset <= diasEnMes,
    })
  }

  const semanas: DiaCelda[][] = []
  for (let i = 0; i < celdas.length; i += 7) semanas.push(celdas.slice(i, i + 7))
  return semanas
}

function hoySantiago(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date())
}

interface Segmento {
  evento: EventoListItem
  columna: number // 1..7
  span: number
  esInicio: boolean
  esFin: boolean
}

// Recorta cada evento a los días de la semana; los multi-semana repiten un
// segmento por fila. Comparaciones sobre strings 'YYYY-MM-DD' (sin UTC pitfalls).
function segmentosDeSemana(semana: DiaCelda[], eventos: EventoListItem[]): Segmento[] {
  const inicioSemana = semana[0]!.key
  const finSemana = semana[6]!.key
  const segmentos: Segmento[] = []

  for (const evento of eventos) {
    const ini = evento.fechaInicio!.slice(0, 10)
    const fin = (evento.fechaFin ?? evento.fechaInicio!).slice(0, 10)
    const segIni = ini > inicioSemana ? ini : inicioSemana
    const segFin = fin < finSemana ? fin : finSemana
    if (segIni > segFin) continue

    const idxIni = semana.findIndex((d) => d.key === segIni)
    const idxFin = semana.findIndex((d) => d.key === segFin)
    if (idxIni === -1 || idxFin === -1) continue

    segmentos.push({
      evento,
      columna: idxIni + 1,
      span: idxFin - idxIni + 1,
      esInicio: segIni === ini,
      esFin: segFin === fin,
    })
  }
  return segmentos
}

export function EventoCalendar({ eventos, mes, onSelect }: EventoCalendarProps) {
  // Solo lo publicado/realizado va al calendario (spec §7); borradores y
  // cancelados siguen visibles para el admin en la vista de lista.
  const visibles = eventos.filter(
    (e) => (e.estado === 'PUBLICADO' || e.estado === 'FINALIZADO') && e.fechaInicio,
  )
  const semanas = construirSemanas(mes)
  const hoy = hoySantiago()

  const delMes = visibles
    .filter((e) => {
      const ini = e.fechaInicio!.slice(0, 10)
      const fin = (e.fechaFin ?? e.fechaInicio!).slice(0, 10)
      return ini <= `${mes}-31` && fin >= `${mes}-01`
    })
    .sort((a, b) => a.fechaInicio!.localeCompare(b.fechaInicio!))

  const categoriasPresentes = [
    ...new Map(delMes.filter((e) => e.categoria).map((e) => [e.categoria!.id, e.categoria!])).values(),
  ]

  function colorDe(evento: EventoListItem): string {
    return evento.categoria?.color ?? COLOR_SIN_CATEGORIA
  }

  return (
    <div>
      <div className="bg-white rounded-2xl border border-[#4a6fad]/15 shadow-sm overflow-hidden">
        {/* Encabezado de días */}
        <div className="grid grid-cols-7 bg-[#f0f4fb] border-b border-[#4a6fad]/15">
          {DIAS_LARGO.map((dia, i) => (
            <div
              key={dia}
              className="py-2 text-center text-[10px] font-bold tracking-wider text-[#4a6fad]"
            >
              <span className="hidden sm:inline">{dia}</span>
              <span className="sm:hidden">{DIAS_CORTO[i]}</span>
            </div>
          ))}
        </div>

        {semanas.map((semana, w) => {
          const segmentos = segmentosDeSemana(semana, visibles)
          return (
            <div key={w} className="relative border-b border-[#4a6fad]/10 last:border-b-0">
              {/* Fondo: separadores de columna, días vecinos y hoy */}
              <div className="absolute inset-0 grid grid-cols-7 pointer-events-none" aria-hidden="true">
                {semana.map((d) => (
                  <div
                    key={d.key}
                    className={[
                      'border-r border-[#4a6fad]/10 last:border-r-0',
                      !d.delMes ? 'bg-slate-50/80' : '',
                      d.key === hoy ? 'bg-[#e8eef7]/60' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  />
                ))}
              </div>

              <div className="relative">
                {/* Números de día */}
                <div className="grid grid-cols-7">
                  {semana.map((d) => (
                    <div key={d.key} className="h-7 px-1.5 pt-1 text-right">
                      <span
                        className={[
                          'text-xs font-medium',
                          d.key === hoy
                            ? 'inline-flex items-center justify-center w-5 h-5 rounded-full bg-[#264c99] text-white font-bold'
                            : d.delMes
                              ? 'text-slate-700'
                              : 'text-slate-400',
                        ].join(' ')}
                      >
                        {d.dia}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Chips (≥sm): un segmento por semana, recortado a sus días */}
                <div className="hidden sm:grid grid-cols-7 auto-rows-min content-start gap-y-0.5 px-0.5 pb-1.5 min-h-[3.25rem]">
                  {segmentos.map((seg, i) => (
                    <button
                      key={`${seg.evento.id}-${i}`}
                      onClick={() => onSelect(seg.evento.id)}
                      title={seg.evento.titulo}
                      className={[
                        'text-[11px] font-semibold text-left leading-tight truncate px-1.5 py-0.5 mx-px',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#264c99]',
                        'hover:opacity-85 transition-opacity',
                        seg.esInicio ? 'rounded-l-md' : '',
                        seg.esFin ? 'rounded-r-md' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      style={{
                        gridColumn: `${seg.columna} / span ${seg.span}`,
                        ...categoriaChipStyle(colorDe(seg.evento), 'solid'),
                      }}
                    >
                      {seg.evento.titulo}
                    </button>
                  ))}
                </div>

                {/* Puntos (<sm): un punto por evento por día */}
                <div className="sm:hidden grid grid-cols-7 px-0.5 pb-1.5 min-h-[1.25rem]">
                  {semana.map((d) => {
                    const delDia = visibles.filter((e) => {
                      const ini = e.fechaInicio!.slice(0, 10)
                      const fin = (e.fechaFin ?? e.fechaInicio!).slice(0, 10)
                      return ini <= d.key && d.key <= fin
                    })
                    return (
                      <div key={d.key} className="flex flex-wrap items-start justify-center gap-0.5 px-0.5">
                        {delDia.slice(0, 4).map((e) => (
                          <span
                            key={e.id}
                            className="w-1.5 h-1.5 rounded-full"
                            style={{ backgroundColor: colorDe(e) }}
                            aria-hidden="true"
                          />
                        ))}
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Lista compacta del mes (solo móvil): los puntos no son clickeables */}
      {delMes.length > 0 && (
        <div className="sm:hidden mt-3 flex flex-col gap-1.5">
          {delMes.map((e) => (
            <button
              key={e.id}
              onClick={() => onSelect(e.id)}
              className="flex items-center gap-2.5 bg-white rounded-xl border border-[#4a6fad]/15 shadow-sm px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#264c99]"
            >
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ backgroundColor: colorDe(e) }}
                aria-hidden="true"
              />
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-medium text-slate-900 truncate">{e.titulo}</span>
                <span className="block text-xs text-[#757874]">
                  {formatRangoFechas(e.fechaInicio, e.fechaFin)}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Leyenda: solo las categorías presentes en el mes */}
      {categoriasPresentes.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
          {categoriasPresentes.map((cat) => (
            <span key={cat.id} className="inline-flex items-center gap-1.5 text-xs text-[#757874]">
              <span
                className="w-2.5 h-2.5 rounded-full"
                style={{ backgroundColor: cat.color }}
                aria-hidden="true"
              />
              {cat.nombre}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
