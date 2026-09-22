// Núcleo puro del aislamiento multi-club: dado un modelo, una operación de
// Prisma y los argumentos que el llamador quiere ejecutar, decide los
// argumentos REALES a ejecutar (o lanza) según el contexto de tenant vigente.
// No importa Prisma ni nada con I/O — solo depende del tipo TenantStore, así
// que se puede probar con objetos planos, sin tocar la base de datos.
//
// Hay ~133 sitios de llamada directa `prisma.<modelo>.<operacion>` y ninguna
// capa de repositorio: por eso el aislamiento se aplica ACÁ, una sola vez,
// como middleware de query del cliente Prisma (ver lib/prisma.ts), en vez de
// confiar en que cada sitio de llamada recuerde filtrar por club.
import { TenantContextError, type TenantStore } from './tenant-context.js';

export { TenantContextError };

// Los 15 modelos de negocio: toda fila pertenece a exactamente un club.
export const TENANT_MODELS = [
  'User',
  'DashboardLayout',
  'Invitacion',
  'Salida',
  'EvaluacionToken',
  'EvaluacionRespuesta',
  'Cierre',
  'Documento',
  'Integrante',
  'CategoriaEvento',
  'GestorCategoria',
  'DeclaracionJuradaVersion',
  'Evento',
  'Inscripcion',
  'Notificacion',
] as const;

// Modelos sin organizationId: no pertenecen a ningún club y jamás se filtran.
export const GLOBAL_MODELS = ['AppSecret'] as const;

// Organization no está en TENANT_MODELS (no tiene columna organizationId; ES
// el club) ni en GLOBAL_MODELS (si hay un contexto de club activo, ese club
// solo puede ver/tocar su propia fila) — se trata aparte, "auto-alcanzado".
export const ORGANIZATION_MODEL = 'Organization';

type TenantModelSet = readonly string[];
const TENANT_MODEL_SET: TenantModelSet = TENANT_MODELS;
const GLOBAL_MODEL_SET: TenantModelSet = GLOBAL_MODELS;

export interface ScopeArgsParams {
  model: string;
  operation: string;
  args: Record<string, unknown> | undefined;
  store: TenantStore | undefined;
}

type Args = Record<string, unknown>;

function isPlainObject(value: unknown): value is Args {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Operaciones cuyo único punto de entrada relevante es `where`.
const READ_DELETE_OPS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
  'delete',
  'deleteMany',
]);

// Operaciones con `where` + `data`: una fila jamás cambia de club al editarla.
const UPDATE_OPS = new Set(['update', 'updateMany', 'updateManyAndReturn']);

// Operaciones de creación cuyo único punto de entrada relevante es `data`.
const CREATE_SINGLE_OPS = new Set(['create', 'createManyAndReturn']);

/**
 * Punto de entrada único. `store === undefined` es SIEMPRE un error: una
 * consulta ejecutada fuera de runWithOrganization/runAsPlatform es un bug
 * (fail closed), nunca un caso a tolerar en silencio.
 */
export function scopeArgs(params: ScopeArgsParams): unknown {
  const { model, operation, store } = params;
  const args: Args = params.args ?? {};

  if (store === undefined) {
    throw new TenantContextError(
      `"${model}.${operation}" se ejecutó sin ningún contexto de tenant activo (falta runWithOrganization o runAsPlatform). ` +
        'Esto es un bug: ninguna consulta puede correr sin un contexto explícito.',
    );
  }

  if (store.kind === 'platform') {
    return args;
  }

  const { organizationId } = store;

  if (model === ORGANIZATION_MODEL) {
    return scopeOrganizationSelf(operation, args, organizationId);
  }

  if (GLOBAL_MODEL_SET.includes(model)) {
    return args;
  }

  if (!TENANT_MODEL_SET.includes(model)) {
    throw new TenantContextError(
      `Modelo desconocido para el aislamiento multi-club: "${model}". Agrégalo a TENANT_MODELS, GLOBAL_MODELS ` +
        'u ORGANIZATION_MODEL en lib/scope-args.ts — esto es intencional: un modelo nuevo debe declarar su ' +
        'alcance explícitamente, nunca heredar uno por accidente.',
    );
  }

  return scopeTenantModel(model, operation, args, organizationId);
}

function scopeTenantModel(model: string, operation: string, args: Args, organizationId: string): Args {
  if (READ_DELETE_OPS.has(operation)) {
    return { ...args, where: scopeWhere(args['where'], organizationId, model, operation) };
  }

  if (UPDATE_OPS.has(operation)) {
    return {
      ...args,
      where: scopeWhere(args['where'], organizationId, model, operation),
      data: scopeUpdateData(args['data'], organizationId, model, operation),
    };
  }

  if (CREATE_SINGLE_OPS.has(operation)) {
    return { ...args, data: scopeCreateData(args['data'], organizationId, model, operation) };
  }

  if (operation === 'createMany') {
    const data = args['data'];
    const scopedData = Array.isArray(data)
      ? data.map((row) => scopeCreateData(row, organizationId, model, operation))
      : scopeCreateData(data, organizationId, model, operation);
    return { ...args, data: scopedData };
  }

  if (operation === 'upsert') {
    return {
      ...args,
      where: scopeWhere(args['where'], organizationId, model, operation),
      create: scopeCreateData(args['create'], organizationId, model, operation),
      update: scopeUpdateData(args['update'], organizationId, model, operation),
    };
  }

  throw new TenantContextError(
    `Operación "${operation}" sobre "${model}" no está contemplada por el aislamiento multi-club. Revisa ` +
      'lib/scope-args.ts: una operación nueva de Prisma debe declarar explícitamente cómo se filtra por club.',
  );
}

// Organization es la fila del club: dentro de un contexto de club, cualquier
// operación queda fijada a where.id === organizationId (nunca ve ni toca otro
// club). No admite create/createMany: dar de alta un club nuevo es una
// operación de plataforma (fuera de este archivo).
function scopeOrganizationSelf(operation: string, args: Args, organizationId: string): Args {
  const opsConWhere = new Set([...READ_DELETE_OPS, ...UPDATE_OPS]);

  if (opsConWhere.has(operation)) {
    const scoped: Args = { ...args, where: scopeOrganizationWhere(args['where'], organizationId, operation) };
    if (UPDATE_OPS.has(operation)) {
      scoped['data'] = scopeUpdateData(args['data'], organizationId, ORGANIZATION_MODEL, operation);
    }
    return scoped;
  }

  if (operation === 'upsert') {
    return {
      ...args,
      where: scopeOrganizationWhere(args['where'], organizationId, operation),
      update: scopeUpdateData(args['update'], organizationId, ORGANIZATION_MODEL, operation),
    };
  }

  throw new TenantContextError(
    `Operación "${operation}" sobre "Organization" no está permitida dentro de un contexto de club: un club ` +
      'solo puede leer o actualizar su propia fila. Usa runAsPlatform para administrar organizaciones.',
  );
}

function scopeOrganizationWhere(where: unknown, organizationId: string, operation: string): Args {
  const whereObj: Args = isPlainObject(where) ? { ...where } : {};
  if ('id' in whereObj && whereObj['id'] !== organizationId) {
    throw new TenantContextError(
      `"Organization.${operation}" intentó filtrar por id="${String(whereObj['id'])}" dentro del contexto ` +
        `del club "${organizationId}": un club nunca puede leer ni tocar la fila de otro club.`,
    );
  }
  whereObj['id'] = organizationId;
  return whereObj;
}

// Agrega organizationId como filtro de nivel superior (ANDs con cualquier otra
// condición, incluido un OR de nivel superior) o lanza si el llamador ya traía
// uno distinto — nunca se sobrescribe en silencio.
function scopeWhere(where: unknown, organizationId: string, model: string, operation: string): Args {
  const whereObj: Args = isPlainObject(where) ? { ...where } : {};
  if ('organizationId' in whereObj && whereObj['organizationId'] !== organizationId) {
    throw new TenantContextError(
      `"${model}.${operation}" intentó filtrar por organizationId="${String(whereObj['organizationId'])}" ` +
        `dentro del contexto del club "${organizationId}": un club nunca puede leer ni tocar filas de otro club.`,
    );
  }
  whereObj['organizationId'] = organizationId;
  return whereObj;
}

// Toda fila nueva debe declarar el club del contexto vigente; nunca se infiere
// ni se completa en silencio con el del contexto (eso ocultaría un bug en el
// llamador que olvidó pasarlo).
function scopeCreateData(data: unknown, organizationId: string, model: string, operation: string): Args {
  if (!isPlainObject(data)) {
    throw new TenantContextError(`"${model}.${operation}" no incluyó "data" con organizationId.`);
  }
  if (data['organizationId'] !== organizationId) {
    throw new TenantContextError(
      `"${model}.${operation}" debe crear con organizationId="${organizationId}" (el club del contexto ` +
        `vigente); recibió organizationId="${String(data['organizationId'])}".`,
    );
  }
  return { ...data };
}

// Una fila jamás cambia de club: si el llamador incluye organizationId en un
// update y difiere del contexto vigente, se rechaza. Si no lo incluye, el dato
// no se toca (no hace falta agregarlo: el `where` ya lo fija).
function scopeUpdateData(data: unknown, organizationId: string, model: string, operation: string): unknown {
  if (!isPlainObject(data)) {
    return data;
  }
  if ('organizationId' in data && data['organizationId'] !== organizationId) {
    throw new TenantContextError(
      `"${model}.${operation}" intentó mover la fila al club "${String(data['organizationId'])}": una fila ` +
        'nunca cambia de club.',
    );
  }
  return { ...data };
}
