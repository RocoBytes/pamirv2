import { describe, expect, it } from 'vitest'
import {
  registroIntegranteBaseSchema,
  registroIntegranteSchema,
  REGISTRO_INTEGRANTE_STEP_IDS,
  REGISTRO_INTEGRANTE_STEP_FIELDS,
  REGISTRO_INTEGRANTE_STEPS,
  FIRST_STEP,
  LAST_STEP,
  stepForField,
  firstStepWithErrors,
  firstErrorFieldInStep,
  nextStep,
  previousStep,
  progressLabel,
  validateRegistroStep,
  staleErrorFields,
  type IntegranteFormData,
  type IntegranteField,
} from './registro-integrante-steps'

describe('REGISTRO_INTEGRANTE_STEP_FIELDS — cobertura contra el schema', () => {
  it('todo campo del schema pertenece a exactamente un paso', () => {
    // Si alguien agrega un campo al schema y olvida asignarlo a un paso (o al
    // revés), este test falla: es la garantía pedida por el encargo.
    const schemaFields = Object.keys(registroIntegranteBaseSchema.shape).sort()
    const mappedFields = Object.values(REGISTRO_INTEGRANTE_STEP_FIELDS).flat().sort()
    expect(mappedFields).toEqual(schemaFields)
  })

  it('ningún campo aparece en más de un paso', () => {
    const mappedFields = Object.values(REGISTRO_INTEGRANTE_STEP_FIELDS).flat()
    expect(new Set(mappedFields).size).toBe(mappedFields.length)
  })
})

describe('REGISTRO_INTEGRANTE_STEPS', () => {
  it('declara los 4 pasos en orden, con número y título', () => {
    expect(REGISTRO_INTEGRANTE_STEPS.map((s) => s.id)).toEqual([1, 2, 3, 4])
    expect(REGISTRO_INTEGRANTE_STEPS.map((s) => s.number)).toEqual(['I', 'II', 'III', 'IV'])
  })

  it('FIRST_STEP y LAST_STEP delimitan el rango', () => {
    expect(FIRST_STEP).toBe(1)
    expect(LAST_STEP).toBe(4)
  })
})

describe('stepForField', () => {
  it('resuelve el paso de un campo conocido de cada sección', () => {
    expect(stepForField('rut')).toBe(1)
    expect(stepForField('telefonoContacto')).toBe(2)
    expect(stepForField('grupoSanguineo')).toBe(3)
    expect(stepForField('derechoImagen')).toBe(4)
  })

  it('un campo que no existe en el schema no resuelve a ningún paso', () => {
    expect(stepForField('membresiaClub')).toBeUndefined()
    expect(stepForField('campoInexistente')).toBeUndefined()
  })
})

describe('firstStepWithErrors', () => {
  it('sin errores, no hay paso al que saltar', () => {
    expect(firstStepWithErrors({})).toBeUndefined()
  })

  it('devuelve el primer paso (en orden) que tiene un campo con error', () => {
    expect(firstStepWithErrors({ derechoImagen: {}, rut: {} })).toBe(1)
  })

  it('un error solo en un paso posterior salta directo a ese paso', () => {
    expect(firstStepWithErrors({ grupoSanguineo: {} })).toBe(3)
  })
})

describe('firstErrorFieldInStep', () => {
  it('devuelve el primer campo con error del paso, en el orden declarado', () => {
    expect(firstErrorFieldInStep(1, { region: {}, rut: {} })).toBe('rut')
  })

  it('sin errores en ese paso, devuelve undefined', () => {
    expect(firstErrorFieldInStep(2, { rut: {} })).toBeUndefined()
  })
})

describe('nextStep / previousStep', () => {
  it('avanza un paso', () => {
    expect(nextStep(1)).toBe(2)
    expect(nextStep(3)).toBe(4)
  })

  it('no avanza más allá del último paso', () => {
    expect(nextStep(4)).toBe(4)
  })

  it('retrocede un paso', () => {
    expect(previousStep(3)).toBe(2)
  })

  it('no retrocede antes del primer paso', () => {
    expect(previousStep(1)).toBe(1)
  })
})

describe('progressLabel', () => {
  it('arma la etiqueta "Paso N de 4"', () => {
    expect(progressLabel(1)).toBe('Paso 1 de 4')
    expect(progressLabel(4)).toBe('Paso 4 de 4')
  })
})

describe('REGISTRO_INTEGRANTE_STEP_IDS', () => {
  it('son 4 pasos consecutivos empezando en 1', () => {
    expect(REGISTRO_INTEGRANTE_STEP_IDS).toEqual([1, 2, 3, 4])
  })
})

// ─── validateRegistroStep ─────────────────────────────────────────────────────
// Regresión del bug real: en Zod, un .superRefine() sobre un objeto NO corre
// si el objeto base ya falló. Mientras la persona está en el paso 3, los
// z.literal(true) del paso 4 siguen sin definir, así que validar contra el
// schema COMPLETO (como hacía trigger() del resolver) nunca llegaba a
// ejecutar la regla "si Sí, el detalle es obligatorio". Cada caso de abajo
// prueba que validateRegistroStep(3, ...) la aplica IGUAL, sin que importe el
// estado de los demás pasos.

const VALID_STEP1: Partial<IntegranteFormData> = {
  nombreCompleto: 'Test Persona',
  rut: '12.345.678-K',
  nacionalidad: 'Chilena',
  genero: 'FEMENINO',
  fechaNacimiento: '1990-01-01',
  direccion: 'Calle 123',
  comuna: 'Santiago',
  region: 'Metropolitana de Santiago',
  telefonoCelular: '+56912345678',
  email: 'test@example.com',
  previsionSalud: 'Fonasa',
}

const VALID_STEP2: Partial<IntegranteFormData> = {
  nombreContacto: 'Contacto',
  parentesco: 'Madre',
  telefonoContacto: '+56987654321',
}

const VALID_STEP3: Partial<IntegranteFormData> = {
  grupoSanguineo: 'O+',
  alergiasTiene: false,
  alergiasDetalle: '',
  enfermedadesCronicasTiene: false,
  enfermedadesCronicasDetalle: '',
  medicamentosTiene: false,
  medicamentosDetalle: '',
  cirugiasLesionesTiene: false,
  cirugiasLesionesDetalle: '',
  fuma: false,
  usaLentes: false,
}

const VALID_STEP4: Partial<IntegranteFormData> = {
  declaracionSalud: true,
  aceptacionRiesgo: true,
  consentimientoDatos: true,
  derechoImagen: true,
}

function baseStep3Values(overrides: Partial<IntegranteFormData> = {}): Partial<IntegranteFormData> {
  return { ...VALID_STEP3, ...overrides }
}

function completeValidFormValues(overrides: Partial<IntegranteFormData> = {}): IntegranteFormData {
  return { ...VALID_STEP1, ...VALID_STEP2, ...VALID_STEP3, ...VALID_STEP4, ...overrides } as IntegranteFormData
}

const CONDITIONAL_PAIRS: { tiene: IntegranteField; detalle: IntegranteField; message: string }[] = [
  { tiene: 'alergiasTiene', detalle: 'alergiasDetalle', message: 'Describe las alergias conocidas' },
  {
    tiene: 'enfermedadesCronicasTiene',
    detalle: 'enfermedadesCronicasDetalle',
    message: 'Describe las enfermedades crónicas',
  },
  { tiene: 'medicamentosTiene', detalle: 'medicamentosDetalle', message: 'Indica el nombre y dosis del medicamento' },
  { tiene: 'cirugiasLesionesTiene', detalle: 'cirugiasLesionesDetalle', message: 'Describe la cirugía o lesión' },
]

describe.each(CONDITIONAL_PAIRS)('validateRegistroStep — paso 3, condicional de $tiene', ({ tiene, detalle, message }) => {
  it('con Sí y detalle vacío reporta el error — sin depender del paso 4 (campos de paso 4 ausentes)', () => {
    // A propósito: `values` no trae NINGÚN campo del paso 4 (como ocurre de
    // verdad mientras la persona está parada en el paso 3).
    const issues = validateRegistroStep(3, baseStep3Values({ [tiene]: true, [detalle]: '' }))
    expect(issues).toContainEqual({ field: detalle, message })
  })

  it('con Sí y detalle en blanco (solo espacios) también reporta el error', () => {
    const issues = validateRegistroStep(3, baseStep3Values({ [tiene]: true, [detalle]: '   ' }))
    expect(issues).toContainEqual({ field: detalle, message })
  })

  it('con Sí y detalle relleno, no reporta error', () => {
    const issues = validateRegistroStep(3, baseStep3Values({ [tiene]: true, [detalle]: 'Detalle real' }))
    expect(issues.some((i) => i.field === detalle)).toBe(false)
  })

  it('con No, nunca exige detalle', () => {
    const issues = validateRegistroStep(3, baseStep3Values({ [tiene]: false, [detalle]: '' }))
    expect(issues.some((i) => i.field === detalle)).toBe(false)
  })

  it('el schema completo también lo reporta cuando el resto del formulario es válido (submit final)', () => {
    const result = registroIntegranteSchema.safeParse(completeValidFormValues({ [tiene]: true, [detalle]: '' }))
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path[0] === detalle)).toBe(true)
    }
  })
})

describe('validateRegistroStep — casos válidos por paso', () => {
  it('paso 1 completo y válido no reporta errores', () => {
    expect(validateRegistroStep(1, VALID_STEP1)).toEqual([])
  })

  it('paso 2 completo y válido no reporta errores', () => {
    expect(validateRegistroStep(2, VALID_STEP2)).toEqual([])
  })

  it('paso 3 completo y válido no reporta errores', () => {
    expect(validateRegistroStep(3, VALID_STEP3)).toEqual([])
  })

  it('paso 4 completo y válido no reporta errores', () => {
    expect(validateRegistroStep(4, VALID_STEP4)).toEqual([])
  })

  it('paso 1 sigue reportando errores de campo normales (no solo los condicionales)', () => {
    const issues = validateRegistroStep(1, { ...VALID_STEP1, nombreCompleto: '' })
    expect(issues).toContainEqual({ field: 'nombreCompleto', message: 'Campo requerido' })
  })
})

describe('validateRegistroStep — aislamiento entre pasos', () => {
  it('el paso 1 nunca reporta campos de otro paso, aunque vengan "rotos" en los values', () => {
    const issues = validateRegistroStep(1, {
      ...VALID_STEP1,
      alergiasTiene: true,
      alergiasDetalle: '', // paso 3 "roto" a propósito
      declaracionSalud: undefined, // paso 4 "roto" a propósito
    })
    expect(issues).toEqual([])
  })

  it('el paso 2 nunca reporta campos de otro paso', () => {
    const issues = validateRegistroStep(2, { ...VALID_STEP2, alergiasTiene: true, alergiasDetalle: '' })
    expect(issues).toEqual([])
  })

  it('el paso 4 nunca reporta campos de otro paso', () => {
    const issues = validateRegistroStep(4, { ...VALID_STEP4, alergiasTiene: true, alergiasDetalle: '' })
    expect(issues).toEqual([])
  })
})

// ─── staleErrorFields ─────────────────────────────────────────────────────────
// Decide qué errores limpia la revalidación en vivo de RegistroIntegrante.tsx.
// Regresión del "Maximum update depth exceeded": el efecto llamaba
// clearErrors() para todo campo válido del paso, haya o no error pintado, y
// cada llamada notifica al formulario → render → efecto → clearErrors → ...
// La garantía que protege este bloque: sin error pintado, NO se limpia nada.

const NO_ERRORS = () => false
const ERRORS_ON = (...fields: IntegranteField[]) => {
  const set = new Set(fields)
  return (field: IntegranteField) => set.has(field)
}

describe('staleErrorFields', () => {
  it('sin ningún error pintado no devuelve nada, aunque todos los valores sean válidos (corta el bucle)', () => {
    expect(staleErrorFields(1, VALID_STEP1, NO_ERRORS)).toEqual([])
    expect(staleErrorFields(2, VALID_STEP2, NO_ERRORS)).toEqual([])
    expect(staleErrorFields(3, VALID_STEP3, NO_ERRORS)).toEqual([])
    expect(staleErrorFields(4, VALID_STEP4, NO_ERRORS)).toEqual([])
  })

  it('devuelve el campo que tiene error y cuyo valor ya es válido', () => {
    expect(staleErrorFields(1, VALID_STEP1, ERRORS_ON('nombreCompleto'))).toEqual(['nombreCompleto'])
  })

  it('no devuelve un campo con error cuyo valor sigue siendo inválido', () => {
    const values = { ...VALID_STEP1, nombreCompleto: '' }
    expect(staleErrorFields(1, values, ERRORS_ON('nombreCompleto'))).toEqual([])
  })

  it('devuelve solo los corregidos cuando hay varios errores pintados, en el orden del paso', () => {
    const values = { ...VALID_STEP1, rut: 'mal-formado' }
    expect(staleErrorFields(1, values, ERRORS_ON('rut', 'region', 'nombreCompleto'))).toEqual([
      'nombreCompleto',
      'region',
    ])
  })

  it('ignora los errores pintados en campos de otro paso', () => {
    expect(staleErrorFields(2, VALID_STEP2, ERRORS_ON('nombreCompleto', 'alergiasDetalle'))).toEqual([])
  })

  it('paso 3: el detalle de "Sí" sigue sin limpiarse hasta que se rellena', () => {
    const sinDetalle = baseStep3Values({ alergiasTiene: true, alergiasDetalle: '' })
    expect(staleErrorFields(3, sinDetalle, ERRORS_ON('alergiasDetalle'))).toEqual([])

    const conDetalle = baseStep3Values({ alergiasTiene: true, alergiasDetalle: 'Penicilina' })
    expect(staleErrorFields(3, conDetalle, ERRORS_ON('alergiasDetalle'))).toEqual(['alergiasDetalle'])
  })

  it('paso 3: cambiar a "No" limpia el error del detalle que ya no es obligatorio', () => {
    const values = baseStep3Values({ alergiasTiene: false, alergiasDetalle: '' })
    expect(staleErrorFields(3, values, ERRORS_ON('alergiasDetalle'))).toEqual(['alergiasDetalle'])
  })
})
