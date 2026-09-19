import { useState, useCallback } from 'react'
import { Users, Radio, Map, X, Check } from 'lucide-react'
import logoPamir from '../../assets/logo_PAMIR.png'
import type { SalidaFormData, User } from '../../types/salida'
import { saveDraft, loadDraft, loadDraftStep, clearDraft, saveDraftStep } from '../../lib/storage'
import { createSalida, uploadGpx, uploadPronostico } from '../../lib/api'
import { Button } from '../ui/Button'
import { Step1General } from './Step1General'
import { Step2Participants } from './Step2Participants'
import { Step3HumanTeam } from './Step3Equipment'
import { Step4Communications } from './Step4GPX'
import { Step5Status, type Step5Data } from './Step5Status'

interface WizardLayoutProps {
  user: User
  isAdmin: boolean
  onDone: () => void
  onCancel: () => void
  onCreateIntegrante: () => void
}

type StepId = 1 | 2 | 3 | 4 | 5

interface StepMeta {
  id: StepId
  label: string
  shortLabel: string
  icon: React.ReactNode
}


const STEPS: StepMeta[] = [
  { id: 1, label: 'Clasificacion de la Salida', shortLabel: 'Clasificacion', icon: <Users size={16} /> },
  { id: 2, label: 'Cronologia y Seguridad', shortLabel: 'Cronologia', icon: <Users size={16} /> },
  { id: 3, label: 'Equipo Humano', shortLabel: 'Equipo', icon: <Users size={16} /> },
  { id: 4, label: 'Comunicaciones y Equipo Crítico', shortLabel: 'Comunicaciones', icon: <Radio size={16} /> },
  { id: 5, label: 'Planificación Técnica', shortLabel: 'Plan Técnico', icon: <Map size={16} /> },
]

const EMPTY_FORM: Omit<SalidaFormData, 'gpxFile'> = {
  tipoSalida: 'NO_OFICIAL',
  disciplina: 'TREKKING',
  temporada: 'estival',
  nombreActividad: '',
  ubicacionGeografica: '',
  fechaInicio: '',
  horaInicio: '',
  fechaRetornoEstimada: '',
  horaRetornoEstimada: '',
  horaAlerta: '',
  avisosExternos: [],
  retenCarabineros: '',
  nombreFamiliar: '',
  telefonoFamiliar: '',
  liderCordada: '',
  participantes: [],
  coordinacionGrupal: false,
  matrizRiesgos: false,
  mediosComunicacion: [],
  idDispositivoFrecuencia: '',
  equipoColectivo: [],
  equipoColectivoOtro: '',
  pronosticoMeteorologico: '',
  riesgosIdentificados: [],
  riesgosOtro: '',
  planEvacuacion: '',
  status: 'EN_CURSO',
  incidentReport: '',
  esRegistroHistorico: false,
}

function hasDraft(): boolean {
  const draft = loadDraft()
  return !!(draft && Object.keys(draft).length > 0)
}

export function WizardLayout({ onDone, onCancel, onCreateIntegrante, isAdmin }: WizardLayoutProps) {
  const [currentStep, setCurrentStep] = useState<StepId>(1)
  const [formData, setFormData] = useState<Omit<SalidaFormData, 'gpxFile'>>(EMPTY_FORM)
  const [gpxFile, setGpxFile] = useState<File | null>(null)
  const [pronosticoFile, setPronosticoFile] = useState<File | null>(null)
  const [completedSteps, setCompletedSteps] = useState<Set<StepId>>(new Set())
  // Initialize banner from localStorage directly in useState — no effect needed
  const [showDraftBanner, setShowDraftBanner] = useState<boolean>(hasDraft)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitSuccess, setSubmitSuccess] = useState(false)
  const [numeroSalida, setNumeroSalida] = useState<number | null>(null)

  const restoreDraft = useCallback(() => {
    const draft = loadDraft()
    const step = loadDraftStep() as StepId
    if (draft) {
      setFormData((prev) => ({ ...prev, ...draft }))
    }
    if (step >= 1 && step <= 5) {
      setCurrentStep(step)
    }
    setShowDraftBanner(false)
  }, [])

  const discardDraft = useCallback(() => {
    clearDraft()
    setShowDraftBanner(false)
    setFormData(EMPTY_FORM)
    setCurrentStep(1)
  }, [])

  const updateFormData = useCallback(
    (data: Partial<Omit<SalidaFormData, 'gpxFile'>>) => {
      setFormData((prev) => {
        const updated = { ...prev, ...data }
        saveDraft(updated)
        return updated
      })
    },
    [],
  )

  const handleStepComplete = useCallback(
    (stepId: StepId, data: Partial<Omit<SalidaFormData, 'gpxFile'>>) => {
      updateFormData(data)
      setCompletedSteps((prev) => new Set([...prev, stepId]))

      if (stepId < 5) {
        const next = (stepId + 1) as StepId
        setCurrentStep(next)
        saveDraftStep(next)
      }
    },
    [updateFormData],
  )

  const goBack = useCallback(() => {
    if (currentStep > 1) {
      const prev = (currentStep - 1) as StepId
      setCurrentStep(prev)
      saveDraftStep(prev)
    }
  }, [currentStep])

  const handleFinalSubmit = useCallback(
    async (step5Data: Step5Data) => {
      const finalData: Omit<SalidaFormData, 'gpxFile'> = {
        ...formData,
        pronosticoMeteorologico: step5Data.pronosticoMeteorologico,
        riesgosIdentificados: step5Data.riesgosIdentificados,
        riesgosOtro: step5Data.riesgosOtro ?? '',
        planEvacuacion: step5Data.planEvacuacion ?? '',
      }
      setIsSubmitting(true)
      setSubmitError(null)

      try {
        {
          const salida = await createSalida(finalData)
          if (gpxFile) {
            await uploadGpx(salida.id, gpxFile)
          }
          if (pronosticoFile) {
            await uploadPronostico(salida.id, pronosticoFile)
          }
          setNumeroSalida(salida.numeroSalida ?? null)
        }

        clearDraft()
        setSubmitSuccess(true)
        setTimeout(onDone, 1500)
      } catch (err) {
        setSubmitError(
          err instanceof Error ? err.message : 'Error al guardar la salida',
        )
        setIsSubmitting(false)
      }
    },
    [formData, gpxFile, pronosticoFile, onDone],
  )

  // Success screen
  if (submitSuccess) {
    return (
      <div className="min-h-screen bg-[#f0f4fb] flex items-center justify-center px-4">
        <div className="text-center">
          <div className="flex items-center justify-center w-16 h-16 rounded-full bg-[#e8eef7] mx-auto mb-4">
            <Check size={32} className="text-[#264c99]" />
          </div>
          <h2 className="text-xl font-bold text-slate-900 mb-2">
            {numeroSalida !== null
              ? `Salida N° ${numeroSalida} registrada`
              : 'Salida registrada'}
          </h2>
          <p className="text-[#757874] text-sm">Redirigiendo...</p>
        </div>
      </div>
    )
  }

  const currentStepMeta = STEPS[currentStep - 1]

  return (
    <div className="min-h-screen bg-[#f0f4fb] flex flex-col">
      {/* Top bar */}
      <header className="bg-white border-b border-[#4a6fad]/15 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <button
            onClick={onCancel}
            className="flex items-center gap-1.5 text-sm text-[#757874] hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#264c99] rounded transition-colors"
            aria-label="Cancelar y volver"
          >
            <X size={18} />
            <span className="hidden sm:inline">Cancelar</span>
          </button>

          <div className="flex items-center gap-2">
            <img src={logoPamir} alt="Pamir Andino Club" className="w-10 h-10 object-contain" />
            <span className="font-semibold text-slate-800 text-sm">
              Nueva Salida
            </span>
          </div>

          <span className="text-xs text-[#757874] font-medium">
            {currentStep} / {STEPS.length}
          </span>
        </div>
      </header>

      {/* Bar stepper */}
      <div className="bg-white border-b border-[#4a6fad]/10">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 pt-3 pb-2">
          {/* Progress bars */}
          <div className="flex gap-1.5 mb-2" role="list" aria-label="Progreso del formulario">
            {STEPS.map((step) => {
              const isCompleted = completedSteps.has(step.id)
              const isActive = step.id === currentStep
              return (
                <div
                  key={step.id}
                  role="listitem"
                  aria-label={`Paso ${step.id}: ${step.label}${isCompleted ? ' (completado)' : isActive ? ' (actual)' : ''}`}
                  className={[
                    'flex-1 h-1 rounded-full transition-colors duration-300',
                    isCompleted || (isActive && completedSteps.has(step.id))
                      ? 'bg-[#264c99]'
                      : isActive
                      ? 'bg-[#264c99]/60'
                      : 'bg-[#dde6f7]',
                  ].join(' ')}
                />
              )
            })}
          </div>
          {/* Current step label */}
          <p className="text-xs font-semibold text-[#264c99] uppercase tracking-wider">
            Paso {currentStep} &mdash; {STEPS[currentStep - 1].label}
          </p>
        </div>
      </div>

      {/* Draft banner */}
      {showDraftBanner && (
        <div className="bg-[#fef9f0] border-b border-[#A4636E]/30">
          <div className="max-w-2xl mx-auto px-4 sm:px-6 py-3 flex flex-col sm:flex-row items-start sm:items-center gap-3 text-sm">
            <p className="text-[#8b5a3a] flex-1">
              Tienes un borrador guardado. ¿Deseas continuar donde lo dejaste?
            </p>
            <div className="flex gap-2 shrink-0">
              <Button size="sm" onClick={restoreDraft}>
                Continuar borrador
              </Button>
              <Button variant="ghost" size="sm" onClick={discardDraft}>
                Descartar
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Step content */}
      <main className="flex-1 max-w-2xl mx-auto w-full px-4 sm:px-6 py-6">
        <div className="mb-6">
          <div className="flex items-center gap-2 text-[#264c99] mb-1">
            {currentStepMeta.icon}
            <span className="text-xs font-semibold uppercase tracking-wider">
              Paso {currentStep} de {STEPS.length}
            </span>
          </div>
          <h2 className="text-xl font-bold text-slate-900">
            {currentStepMeta.label}
          </h2>
        </div>

        {submitError && (
          <div className="flex items-start gap-2 rounded-xl bg-[#f5e8ea] border border-[#A4636E]/30 p-3 mb-5 text-sm text-[#8b3a44]">
            <span>{submitError}</span>
          </div>
        )}

        {currentStep === 1 && (
          <Step1General
            defaultValues={{
              tipoSalida: formData.tipoSalida,
              disciplina: formData.disciplina,
              temporada: formData.temporada,
              nombreActividad: formData.nombreActividad,
              ubicacionGeografica: formData.ubicacionGeografica,
            }}
            onSubmit={(data) => handleStepComplete(1, data)}
          />
        )}
        {currentStep === 2 && (
          <Step2Participants
            defaultValues={{
              esRegistroHistorico: formData.esRegistroHistorico ?? false,
              fechaInicio: formData.fechaInicio,
              horaInicio: formData.horaInicio,
              fechaRetornoEstimada: formData.fechaRetornoEstimada,
              horaRetornoEstimada: formData.horaRetornoEstimada,
              horaAlerta: formData.horaAlerta,
              avisosExternos: formData.avisosExternos,
              retenCarabineros: formData.retenCarabineros ?? '',
              nombreFamiliar: formData.nombreFamiliar ?? '',
              telefonoFamiliar: formData.telefonoFamiliar ?? '',
            }}
            onSubmit={(data) => handleStepComplete(2, data)}
            onBack={goBack}
            isAdmin={isAdmin}
          />
        )}
        {currentStep === 3 && (
          <Step3HumanTeam
            defaultValues={{
              liderCordada: formData.liderCordada,
              participantes: formData.participantes,
              coordinacionGrupal: formData.coordinacionGrupal,
              matrizRiesgos: formData.matrizRiesgos,
            }}
            onSubmit={(data) => handleStepComplete(3, data)}
            onBack={goBack}
            isAdmin={isAdmin}
            onCreateIntegrante={onCreateIntegrante}
          />
        )}
        {currentStep === 4 && (
          <Step4Communications
            defaultValues={{
              mediosComunicacion: formData.mediosComunicacion,
              idDispositivoFrecuencia: formData.idDispositivoFrecuencia,
              equipoColectivo: formData.equipoColectivo,
              equipoColectivoOtro: formData.equipoColectivoOtro,
            }}
            onSubmit={(data) => handleStepComplete(4, data)}
            onBack={goBack}
          />
        )}
        {currentStep === 5 && (
          <Step5Status
            defaultValues={{
              pronosticoMeteorologico: formData.pronosticoMeteorologico,
              riesgosIdentificados: formData.riesgosIdentificados,
              riesgosOtro: formData.riesgosOtro,
              planEvacuacion: formData.planEvacuacion,
            }}
            gpxFile={gpxFile}
            pronosticoFile={pronosticoFile}
            isSubmitting={isSubmitting}
            onFileChange={setGpxFile}
            onPronosticoFileChange={setPronosticoFile}
            onSubmit={handleFinalSubmit}
            onBack={goBack}
          />
        )}
      </main>

    </div>
  )
}
