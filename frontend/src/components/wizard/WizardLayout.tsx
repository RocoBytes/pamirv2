import { useState, useCallback, useEffect } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Users, Radio, Map, X } from 'lucide-react'
import type { SalidaFormData, User } from '../../types/salida'
import { saveDraft, loadDraft, loadDraftStep, clearDraft, saveDraftStep } from '../../lib/storage'
import { clubSlugFromPath } from '../../lib/club-path'
import { createSalida, uploadGpx, uploadPronostico } from '../../lib/api'
import type { RevealOrigin } from '../../lib/reveal-geometry'
import { useStepDirection } from '../../hooks/useStepDirection'
import { Button } from '../ui/Button'
import { stepVariants } from '../ui/motion'
import { SuccessReveal, type RevealStatus } from '../ui/SuccessReveal'
import { ClubLogo } from '../ClubLogo'
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
  const draft = loadDraft(undefined, clubSlugFromPath() ?? undefined)
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
  /** Mientras no sea null hay una onda de confirmación en curso sobre el formulario. */
  const [revealOrigin, setRevealOrigin] = useState<RevealOrigin | null>(null)

  const direction = useStepDirection(currentStep)

  // El paso nuevo entra deslizándose desde arriba: si el usuario venía
  // desplazado al final de un paso largo, lo vería entrar por la mitad.
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [currentStep])

  const restoreDraft = useCallback(() => {
    const clubSlug = clubSlugFromPath() ?? undefined
    const draft = loadDraft(undefined, clubSlug)
    const step = loadDraftStep(undefined, clubSlug) as StepId
    if (draft) {
      setFormData((prev) => ({ ...prev, ...draft }))
    }
    if (step >= 1 && step <= 5) {
      setCurrentStep(step)
    }
    setShowDraftBanner(false)
  }, [])

  const discardDraft = useCallback(() => {
    clearDraft(undefined, clubSlugFromPath() ?? undefined)
    setShowDraftBanner(false)
    setFormData(EMPTY_FORM)
    setCurrentStep(1)
  }, [])

  const updateFormData = useCallback(
    (data: Partial<Omit<SalidaFormData, 'gpxFile'>>) => {
      setFormData((prev) => {
        const updated = { ...prev, ...data }
        saveDraft(updated, undefined, clubSlugFromPath() ?? undefined)
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
        saveDraftStep(next, undefined, clubSlugFromPath() ?? undefined)
      }
    },
    [updateFormData],
  )

  const goBack = useCallback(() => {
    if (currentStep > 1) {
      const prev = (currentStep - 1) as StepId
      setCurrentStep(prev)
      saveDraftStep(prev, undefined, clubSlugFromPath() ?? undefined)
    }
  }, [currentStep])

  const handleFinalSubmit = useCallback(
    async (step5Data: Step5Data, origin: RevealOrigin) => {
      const finalData: Omit<SalidaFormData, 'gpxFile'> = {
        ...formData,
        pronosticoMeteorologico: step5Data.pronosticoMeteorologico,
        riesgosIdentificados: step5Data.riesgosIdentificados,
        riesgosOtro: step5Data.riesgosOtro ?? '',
        planEvacuacion: step5Data.planEvacuacion ?? '',
      }
      // La onda arranca ya, en el mismo cuadro del toque; lo que espera la
      // confirmación del servidor es el check, no la expansión.
      setRevealOrigin(origin)
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

        clearDraft(undefined, clubSlugFromPath() ?? undefined)
        setSubmitSuccess(true)
        // El `setTimeout(onDone, 1500)` que había acá se fue: ahora navega
        // SuccessReveal cuando la confirmación terminó de leerse, en vez de un
        // reloj a ciegas compitiendo contra la animación.
      } catch (err) {
        setSubmitError(
          err instanceof Error ? err.message : 'Error al guardar la salida',
        )
        setIsSubmitting(false)
      }
    },
    [formData, gpxFile, pronosticoFile],
  )

  // La pantalla de éxito ya no reemplaza el wizard con un `return` temprano: la
  // onda se superpone y el formulario queda debajo, que es lo que hace que la
  // confirmación parezca nacer de algo en vez de aparecer de la nada.
  const revealStatus: RevealStatus = submitError
    ? 'error'
    : submitSuccess
      ? 'success'
      : 'saving'

  const currentStepMeta = STEPS[currentStep - 1]

  return (
    <div className="min-h-screen bg-alpine-canvas flex flex-col">
      {/* Top bar */}
      <header className="sticky top-0 z-40 bg-surface-container-lowest/90 backdrop-blur-md border-b border-outline-variant/40 shadow-sm pt-safe">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <button
            onClick={onCancel}
            className="flex items-center gap-1.5 text-sm text-on-surface-variant hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded transition-colors"
            aria-label="Cancelar y volver"
          >
            <X size={18} />
            <span className="hidden sm:inline">Cancelar</span>
          </button>

          <div className="flex items-center gap-2">
            <ClubLogo alt="" className="w-10 h-10 object-contain" />
            <span className="font-semibold text-slate-800 text-sm">
              Nueva Salida
            </span>
          </div>

          <span className="text-xs text-on-surface-variant font-medium">
            {currentStep} / {STEPS.length}
          </span>
        </div>
      </header>

      {/* Bar stepper */}
      <div className="bg-white border-b border-secondary/10">
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
                      ? 'bg-primary'
                      : isActive
                      ? 'bg-primary/60'
                      : 'bg-surface-container',
                  ].join(' ')}
                />
              )
            })}
          </div>
          {/* Current step label */}
          <p className="text-xs font-semibold text-primary uppercase tracking-wider">
            Paso {currentStep} &mdash; {STEPS[currentStep - 1].label}
          </p>
        </div>
      </div>

      {/* Draft banner */}
      {showDraftBanner && (
        <div className="bg-[#fef9f0] border-b border-error/30">
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
          <div className="flex items-center gap-2 text-primary mb-1">
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
          <div
            role="alert"
            className="flex items-start gap-2 rounded-xl bg-error-container border border-error/30 p-3 mb-5 text-sm text-on-error-container"
          >
            <span>{submitError}</span>
          </div>
        )}

        {/* `mode="wait"` y no `sync`/`popLayout`: los pasos tienen alturas muy
            distintas y dos formularios largos superpuestos durante el cruce se
            leen como un borrón. `initial={false}` para que el primer pintado no
            entre deslizándose. */}
        {/* `custom` acá es lo que hace que el paso que SALE conozca la
            dirección actual: sin esto se va siempre para el mismo lado, porque
            AnimatePresence lo dibuja desde la copia que guardó al entrar. */}
        <AnimatePresence mode="wait" initial={false} custom={direction}>
          <motion.div
            key={currentStep}
            custom={direction}
            variants={stepVariants(direction)}
            initial="hidden"
            animate="visible"
            exit="exit"
          >
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
          </motion.div>
        </AnimatePresence>
      </main>

      {revealOrigin && (
        <SuccessReveal
          origin={revealOrigin}
          status={revealStatus}
          title="¡Listo!"
          detail={
            numeroSalida !== null
              ? `Salida N° ${numeroSalida} registrada`
              : 'Salida registrada'
          }
          savingLabel="Guardando salida…"
          onFinished={onDone}
          onRetracted={() => {
            setRevealOrigin(null)
            // El banner de error vive arriba del formulario y el botón que lo
            // provocó está abajo del todo: sin esto, el usuario ve la onda
            // retraerse y el formulario volver sin ninguna explicación a la
            // vista. Un lector de pantalla se entera por el role="alert"; los
            // demás necesitan que los llevemos hasta el mensaje.
            window.scrollTo(0, 0)
          }}
        />
      )}
    </div>
  )
}
