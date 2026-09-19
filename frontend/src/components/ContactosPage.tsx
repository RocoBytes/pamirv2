import { ArrowLeft, Siren, Phone, AlertCircle } from 'lucide-react'
import logoPamir from '../assets/logo_PAMIR.png'

import { Button } from './ui/Button'

// Contactos de emergencia y rescate de Chile. Contenido estático: son números
// nacionales fijos, no requieren backend ni base de datos.
//   numero: texto que se muestra ("136", "600 360 7777")
//   tel:    solo dígitos, para el enlace tel: ("136", "6003607777")
type Contacto = {
  numero: string
  tel: string
  nombre: string
  tag?: 'Montaña' | 'GOPE'
  descripcion: string
}

type Seccion = {
  titulo: string
  contactos: Contacto[]
}

const SECCIONES: Seccion[] = [
  {
    titulo: 'Rescate en montaña',
    contactos: [
      {
        numero: '136',
        tel: '136',
        nombre: 'Cuerpo de Socorro Andino',
        tag: 'Montaña',
        descripcion:
          'Rescate específico en montaña. Primer número a marcar ante emergencia en terreno de altura. Coordinado con Carabineros.',
      },
      {
        numero: '138',
        tel: '138',
        nombre: 'Rescate aéreo',
        tag: 'Montaña',
        descripcion:
          'Coordinación de evacuación aérea. Para casos donde el terreno impide rescate terrestre.',
      },
      {
        numero: '133',
        tel: '133',
        nombre: 'Carabineros / GOPE',
        tag: 'GOPE',
        descripcion:
          'Central de Carabineros. Activa al GOPE (Grupo de Operaciones Especiales) para rescate en alta montaña. Con presencia nacional desde Arica a Punta Arenas.',
      },
    ],
  },
  {
    titulo: 'Emergencias médicas y rescate general',
    contactos: [
      {
        numero: '131',
        tel: '131',
        nombre: 'SAMU',
        descripcion:
          'Ambulancia y atención médica de urgencia. Para lesionados que requieren atención médica inmediata.',
      },
      {
        numero: '132',
        tel: '132',
        nombre: 'Bomberos',
        descripcion:
          'Rescate, incendios y emergencias con riesgo estructural. También actúa en rescates en terreno y accidentes vehiculares en accesos.',
      },
    ],
  },
  {
    titulo: 'Áreas protegidas y entorno natural',
    contactos: [
      {
        numero: '130',
        tel: '130',
        nombre: 'CONAF',
        descripcion:
          'Emergencias en parques nacionales, reservas y áreas silvestres protegidas. Incendios forestales en zonas de actividad.',
      },
      {
        numero: '134',
        tel: '134',
        nombre: 'PDI',
        descripcion:
          'Policía de Investigaciones. Emergencias policiales, búsqueda de personas desaparecidas.',
      },
    ],
  },
  {
    titulo: 'Otros útiles',
    contactos: [
      {
        numero: '600 360 7777',
        tel: '6003607777',
        nombre: 'Salud Responde (MINSAL)',
        descripcion:
          'Orientación médica telefónica 24/7. Útil para consultar sobre síntomas de MAM, hipotermia u otras condiciones antes o después de la salida.',
      },
      {
        numero: '139',
        tel: '139',
        nombre: 'Carabineros — información',
        descripcion:
          'Consultas no urgentes: estado de rutas, condiciones de acceso, comisarías más cercanas a la zona.',
      },
    ],
  },
]

function ContactoCard({ contacto }: { contacto: Contacto }) {
  const tagStyle =
    contacto.tag === 'GOPE'
      ? 'bg-[#f5e8ea] text-[#8b3a44]'
      : 'bg-[#e8eef7] text-[#264c99]'

  return (
    <a
      href={`tel:${contacto.tel}`}
      className="flex items-center gap-4 bg-white rounded-2xl border border-[#4a6fad]/15 shadow-sm p-4 transition-shadow duration-200 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#264c99]"
    >
      <div className="shrink-0 w-14 text-center">
        <span className="block text-xl font-bold text-[#264c99] leading-tight tabular-nums">
          {contacto.numero}
        </span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="font-semibold text-slate-900 text-sm">{contacto.nombre}</h3>
          {contacto.tag && (
            <span
              className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md ${tagStyle}`}
            >
              {contacto.tag}
            </span>
          )}
        </div>
        <p className="text-xs text-[#757874] mt-0.5">{contacto.descripcion}</p>
      </div>
      <Phone size={16} className="shrink-0 text-[#4a6fad]" aria-hidden="true" />
    </a>
  )
}

interface ContactosPageProps {
  onBack: () => void
}

export function ContactosPage({ onBack }: ContactosPageProps) {
  return (
    <div className="min-h-screen bg-[#f0f4fb]">
      <header className="bg-white border-b border-[#4a6fad]/10 sticky top-0 z-10 shadow-sm">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <img src={logoPamir} alt="Pamir Andino Club" className="w-11 h-11 object-contain" />
            <span className="font-bold text-slate-900 text-lg">Pamir</span>
          </div>
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft size={16} />
            Volver
          </Button>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 sm:px-6 py-6">
        <div className="mb-6">
          <div className="flex items-center gap-2 text-[#4a6fad] text-xs font-semibold uppercase tracking-widest mb-1">
            <Siren size={14} />
            Información de seguridad
          </div>
          <h1 className="text-xl font-bold text-slate-900">Contactos esenciales</h1>
          <p className="text-sm text-[#757874] mt-0.5">
            Números de emergencia y rescate en Chile. Toca un número para llamar.
          </p>
        </div>

        <div className="flex flex-col gap-6">
          {SECCIONES.map((seccion) => (
            <section key={seccion.titulo}>
              <h2 className="text-sm font-bold text-[#264c99] uppercase tracking-wide mb-2">
                {seccion.titulo}
              </h2>
              <ul className="flex flex-col gap-2">
                {seccion.contactos.map((contacto) => (
                  <li key={contacto.tel}>
                    <ContactoCard contacto={contacto} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        <div className="mt-6 flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-2xl px-4 py-4">
          <AlertCircle size={20} className="text-amber-500 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-800 leading-relaxed">
            <span className="font-semibold">Importante: </span>
            Antes de salir a zona de alta montaña o sin cobertura, se recomienda dejar los números
            de los organismos locales (comisaría y bomberos del sector más cercano a la ruta) con el
            contacto de emergencia en tierra del grupo. El GOPE se activa siempre a través del 133;
            no tiene línea directa pública.
          </p>
        </div>
      </main>
    </div>
  )
}
