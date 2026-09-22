import { z } from 'zod'

// ─── Schema ───────────────────────────────────────────────────────────────────
// Fuente única de verdad de los campos del formulario: RegistroIntegrante.tsx
// importa `registroIntegranteSchema`/`IntegranteFormData` de acá en vez de
// declarar su propia copia. Así, agregar un campo al formulario significa
// agregarlo acá — y REGISTRO_INTEGRANTE_STEP_FIELDS puede probarse contra
// `registroIntegranteBaseSchema.shape` para detectar un campo que nadie
// asignó a un paso (ver registro-integrante-steps.test.ts).

const RUT_REGEX = /^\d{1,2}\.\d{3}\.\d{3}-[\dKk]$/

export const registroIntegranteBaseSchema = z
  .object({
    // Sección I
    nombreCompleto: z.string().min(1, 'Campo requerido').max(100, 'Máximo 100 caracteres'),
    rut: z.string().regex(RUT_REGEX, 'Formato inválido. Ej: 12.345.678-K'),
    nacionalidad: z.string().min(1, 'Campo requerido'),
    genero: z.enum(['FEMENINO', 'MASCULINO', 'PREFIERO_NO_DECIRLO'], {
      error: 'Selecciona una opción',
    }),
    fechaNacimiento: z.string().min(1, 'Selecciona tu fecha de nacimiento'),
    direccion: z.string().min(1, 'Campo requerido').max(100, 'Máximo 100 caracteres'),
    comuna: z.string().min(1, 'Campo requerido').max(100, 'Máximo 100 caracteres'),
    region: z.string().min(1, 'Selecciona una región'),
    telefonoCelular: z.string().min(1, 'Campo requerido').regex(/^\+?[\d\s\-()]{7,15}$/, 'Teléfono inválido'),
    email: z.string().min(1, 'Campo requerido').email('Email inválido').max(100, 'Máximo 100 caracteres'),
    previsionSalud: z.string().min(1, 'Selecciona tu previsión de salud'),

    // Sección II
    nombreContacto: z.string().min(1, 'Campo requerido').max(100, 'Máximo 100 caracteres'),
    parentesco: z.string().min(1, 'Campo requerido').max(100, 'Máximo 100 caracteres'),
    telefonoContacto: z.string().min(1, 'Campo requerido').regex(/^\+?[\d\s\-()]{7,15}$/, 'Teléfono inválido'),

    // Sección III
    grupoSanguineo: z.string().min(1, 'Selecciona tu grupo sanguíneo'),
    alergiasTiene: z.boolean({ error: 'Selecciona una opción' }),
    alergiasDetalle: z.string().max(200, 'Máximo 200 caracteres').optional(),
    enfermedadesCronicasTiene: z.boolean({ error: 'Selecciona una opción' }),
    enfermedadesCronicasDetalle: z.string().max(200, 'Máximo 200 caracteres').optional(),
    medicamentosTiene: z.boolean({ error: 'Selecciona una opción' }),
    medicamentosDetalle: z.string().max(200, 'Máximo 200 caracteres').optional(),
    cirugiasLesionesTiene: z.boolean({ error: 'Selecciona una opción' }),
    cirugiasLesionesDetalle: z.string().max(200, 'Máximo 200 caracteres').optional(),
    fuma: z.boolean({ error: 'Selecciona una opción' }),
    usaLentes: z.boolean({ error: 'Selecciona una opción' }),

    // Sección IV
    declaracionSalud: z.literal(true, { error: 'Debes aceptar esta declaración para continuar' }),
    aceptacionRiesgo: z.literal(true, { error: 'Debes aceptar esta cláusula para continuar' }),
    consentimientoDatos: z.literal(true, { error: 'Debes aceptar el consentimiento de uso de datos para continuar' }),
    derechoImagen: z.literal(true, { error: 'Debes aceptar esta cláusula para continuar' }),
  })

export type IntegranteFormData = z.infer<typeof registroIntegranteBaseSchema>

// ─── Reglas condicionales "si Sí, el detalle es obligatorio" ───────────────────
// Declaradas UNA sola vez y aplicadas tanto al schema completo (submit final)
// como al schema de paso 3 (ver buildStepSchema más abajo), para que nunca
// puedan quedar desincronizadas entre ambos.
//
// BUG que motiva esto: en Zod, un .superRefine() sobre un z.object() NO corre
// si el object base ya falló — y mientras la persona está en el paso 3, los
// z.literal(true) del paso 4 (declaracionSalud, etc.) todavía están sin
// definir, así que el object base SIEMPRE falla y el superRefine que exige el
// detalle de alergias/enfermedades/medicamentos/cirugías nunca se ejecutaba.
// Validar el paso 3 con SU PROPIO schema (que no conoce los campos del paso
// 4) evita depender de que el resto del formulario ya esté completo.
type ConditionalDetailData = Pick<
  IntegranteFormData,
  | 'alergiasTiene'
  | 'alergiasDetalle'
  | 'enfermedadesCronicasTiene'
  | 'enfermedadesCronicasDetalle'
  | 'medicamentosTiene'
  | 'medicamentosDetalle'
  | 'cirugiasLesionesTiene'
  | 'cirugiasLesionesDetalle'
>

interface ConditionalDetailRule {
  tieneField: keyof ConditionalDetailData & ('alergiasTiene' | 'enfermedadesCronicasTiene' | 'medicamentosTiene' | 'cirugiasLesionesTiene')
  detalleField: keyof ConditionalDetailData & ('alergiasDetalle' | 'enfermedadesCronicasDetalle' | 'medicamentosDetalle' | 'cirugiasLesionesDetalle')
  message: string
}

const CONDITIONAL_DETAIL_RULES: ConditionalDetailRule[] = [
  { tieneField: 'alergiasTiene', detalleField: 'alergiasDetalle', message: 'Describe las alergias conocidas' },
  {
    tieneField: 'enfermedadesCronicasTiene',
    detalleField: 'enfermedadesCronicasDetalle',
    message: 'Describe las enfermedades crónicas',
  },
  {
    tieneField: 'medicamentosTiene',
    detalleField: 'medicamentosDetalle',
    message: 'Indica el nombre y dosis del medicamento',
  },
  { tieneField: 'cirugiasLesionesTiene', detalleField: 'cirugiasLesionesDetalle', message: 'Describe la cirugía o lesión' },
]

function applyConditionalDetailRules(
  data: ConditionalDetailData,
  ctx: z.RefinementCtx,
  rules: readonly ConditionalDetailRule[] = CONDITIONAL_DETAIL_RULES,
): void {
  for (const rule of rules) {
    if (data[rule.tieneField] && !data[rule.detalleField]?.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: rule.message, path: [rule.detalleField] })
    }
  }
}

// Schema completo — usado por el resolver del formulario (react-hook-form) y
// por el submit final: valida TODO a la vez, incluidas las reglas
// condicionales de arriba.
export const registroIntegranteSchema = registroIntegranteBaseSchema.superRefine((data, ctx) =>
  applyConditionalDetailRules(data, ctx),
)

// ─── Pasos del wizard ───────────────────────────────────────────────────────────
// Los mismos 4 bloques que antes eran secciones de un formulario largo, ahora
// un paso cada uno — mismos campos, mismas reglas, mismo copy.

export const REGISTRO_INTEGRANTE_STEP_IDS = [1, 2, 3, 4] as const
export type RegistroIntegranteStepId = (typeof REGISTRO_INTEGRANTE_STEP_IDS)[number]

export const FIRST_STEP: RegistroIntegranteStepId = REGISTRO_INTEGRANTE_STEP_IDS[0]
export const LAST_STEP: RegistroIntegranteStepId =
  REGISTRO_INTEGRANTE_STEP_IDS[REGISTRO_INTEGRANTE_STEP_IDS.length - 1]

export interface RegistroIntegranteStepMeta {
  id: RegistroIntegranteStepId
  number: string
  title: string
}

export const REGISTRO_INTEGRANTE_STEPS: RegistroIntegranteStepMeta[] = [
  { id: 1, number: 'I', title: 'Información Personal y de Contacto' },
  { id: 2, number: 'II', title: 'Contacto de Emergencia' },
  { id: 3, number: 'III', title: 'Perfil Médico y Antecedentes' },
  { id: 4, number: 'IV', title: 'Cláusulas Legales y Consentimiento Informado' },
]

export type IntegranteField = keyof IntegranteFormData

// Todo campo del schema pertenece a EXACTAMENTE un paso — probado contra
// registroIntegranteBaseSchema.shape en registro-integrante-steps.test.ts.
export const REGISTRO_INTEGRANTE_STEP_FIELDS: Record<RegistroIntegranteStepId, IntegranteField[]> = {
  1: [
    'nombreCompleto',
    'rut',
    'nacionalidad',
    'genero',
    'fechaNacimiento',
    'direccion',
    'comuna',
    'region',
    'telefonoCelular',
    'email',
    'previsionSalud',
  ],
  2: ['nombreContacto', 'parentesco', 'telefonoContacto'],
  3: [
    'grupoSanguineo',
    'alergiasTiene',
    'alergiasDetalle',
    'enfermedadesCronicasTiene',
    'enfermedadesCronicasDetalle',
    'medicamentosTiene',
    'medicamentosDetalle',
    'cirugiasLesionesTiene',
    'cirugiasLesionesDetalle',
    'fuma',
    'usaLentes',
  ],
  4: ['declaracionSalud', 'aceptacionRiesgo', 'consentimientoDatos', 'derechoImagen'],
}

const STEP_BY_FIELD = new Map<IntegranteField, RegistroIntegranteStepId>()
for (const stepId of REGISTRO_INTEGRANTE_STEP_IDS) {
  for (const field of REGISTRO_INTEGRANTE_STEP_FIELDS[stepId]) {
    STEP_BY_FIELD.set(field, stepId)
  }
}

export function stepForField(field: string): RegistroIntegranteStepId | undefined {
  return STEP_BY_FIELD.get(field as IntegranteField)
}

// Primer paso (en orden) que tiene al menos un campo con error. Se usa para
// el submit final: react-hook-form entrega un objeto de errores contra TODO
// el schema, y hay que saltar al primer paso anterior que quedó inválido.
export function firstStepWithErrors(
  errors: Partial<Record<IntegranteField, unknown>>,
): RegistroIntegranteStepId | undefined {
  const fieldsWithErrors = Object.keys(errors)
  for (const stepId of REGISTRO_INTEGRANTE_STEP_IDS) {
    if (fieldsWithErrors.some((field) => stepForField(field) === stepId)) {
      return stepId
    }
  }
  return undefined
}

// Primer campo CON ERROR de un paso dado, en el orden declarado arriba — para
// enfocarlo tras un "Siguiente" fallido o un salto por error de submit.
export function firstErrorFieldInStep(
  stepId: RegistroIntegranteStepId,
  errors: Partial<Record<IntegranteField, unknown>>,
): IntegranteField | undefined {
  return REGISTRO_INTEGRANTE_STEP_FIELDS[stepId].find((field) => field in errors)
}

export function nextStep(stepId: RegistroIntegranteStepId): RegistroIntegranteStepId {
  const idx = REGISTRO_INTEGRANTE_STEP_IDS.indexOf(stepId)
  return REGISTRO_INTEGRANTE_STEP_IDS[idx + 1] ?? stepId
}

export function previousStep(stepId: RegistroIntegranteStepId): RegistroIntegranteStepId {
  const idx = REGISTRO_INTEGRANTE_STEP_IDS.indexOf(stepId)
  return REGISTRO_INTEGRANTE_STEP_IDS[idx - 1] ?? stepId
}

export function progressLabel(stepId: RegistroIntegranteStepId): string {
  return `Paso ${stepId} de ${REGISTRO_INTEGRANTE_STEP_IDS.length}`
}

// ─── Validación por paso ────────────────────────────────────────────────────────
// Un schema por paso: registroIntegranteBaseSchema.pick(...) de SOLO los
// campos de ese paso, más las reglas condicionales de arriba que apliquen
// (hoy, solo el paso 3 las tiene todas). "Siguiente" valida con esto en vez
// de con el schema completo — así nunca depende de que otro paso (por
// ejemplo, las cláusulas del paso 4) ya esté lleno.

type StepFieldMask = Partial<Record<IntegranteField, true>>

function pickMask(fields: readonly IntegranteField[]): StepFieldMask {
  const mask: StepFieldMask = {}
  for (const field of fields) mask[field] = true
  return mask
}

function conditionalRulesForFields(fields: readonly IntegranteField[]): ConditionalDetailRule[] {
  const fieldSet = new Set(fields)
  return CONDITIONAL_DETAIL_RULES.filter((rule) => fieldSet.has(rule.tieneField) && fieldSet.has(rule.detalleField))
}

function buildStepSchema(stepId: RegistroIntegranteStepId) {
  const fields = REGISTRO_INTEGRANTE_STEP_FIELDS[stepId]
  const picked = registroIntegranteBaseSchema.pick(pickMask(fields))
  const rules = conditionalRulesForFields(fields)
  if (rules.length === 0) return picked
  // Los campos de las 4 reglas están TODOS presentes en este paso (si no,
  // `rules` habría quedado vacío arriba) — el cast es seguro en tiempo de
  // ejecución aunque pickMask no narrowe el tipo del shape elegido.
  return picked.superRefine((data, ctx) => applyConditionalDetailRules(data as ConditionalDetailData, ctx, rules))
}

const STEP_SCHEMAS = new Map(REGISTRO_INTEGRANTE_STEP_IDS.map((id) => [id, buildStepSchema(id)] as const))

export interface RegistroFieldIssue {
  field: IntegranteField
  message: string
}

// Valida SOLO los campos de `stepId` contra `values` (se le puede pasar el
// objeto completo del formulario: pick() ignora el resto). Nunca reporta un
// campo de otro paso, y nunca depende de que otro paso ya sea válido.
export function validateRegistroStep(
  stepId: RegistroIntegranteStepId,
  values: Partial<IntegranteFormData>,
): RegistroFieldIssue[] {
  const schema = STEP_SCHEMAS.get(stepId)
  if (!schema) return []
  const result = schema.safeParse(values)
  if (result.success) return []
  return result.error.issues.map((issue) => ({
    field: issue.path[0] as IntegranteField,
    message: issue.message,
  }))
}
