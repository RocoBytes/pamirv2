// Datos por defecto que recibe todo club nuevo (ver services/tenants.service.ts):
// sin esto, un club recién creado no es operativo — sin categorías no se puede
// publicar ningún evento, y sin una declaración jurada vigente toda inscripción
// responde 422 (ver getEventoById/inscribirse en controllers/eventos.controller.ts).
// Antes de esta fase estos datos solo existían como SQL de semilla en las
// migraciones de Prisma (20260822120000_add_eventos_module,
// 20260824100000_gestores_categoria), que solo corrió una vez para el club
// original (Andino Club Pamir) — un club nuevo nunca pasa por esas migraciones,
// así que el CLI de alta (scripts/tenant.ts) necesita este mismo contenido
// disponible como código.
import { createHash } from 'node:crypto';

export interface DefaultCategoriaEvento {
  slug: string;
  nombre: string;
  color: string;
  orden: number;
  activa: boolean;
}

// Set vigente HOY en la base de datos de Pamir, tras aplicar también la
// migración 20260824100000_gestores_categoria (que reintrodujo "Excursionismo"
// después de que 20260823020000_categorias_senderismo fusionara Trekking y
// Excursiones en una sola categoría "Senderismo"). Son 6 categorías, no las 6
// originales de la primera migración: Trekking/Excursiones ya no existen.
export const DEFAULT_CATEGORIAS_EVENTO: readonly DefaultCategoriaEvento[] = [
  { slug: 'montanismo-n1', nombre: 'Montañismo N°1', color: '#E8862E', orden: 1, activa: true },
  { slug: 'montanismo-n2', nombre: 'Montañismo N°2', color: '#2F6BD6', orden: 2, activa: true },
  { slug: 'senderismo', nombre: 'Senderismo', color: '#4E805D', orden: 3, activa: true },
  { slug: 'excursionismo', nombre: 'Excursionismo', color: '#8B6A4F', orden: 4, activa: true },
  { slug: 'cursos-talleres', nombre: 'Cursos y talleres', color: '#29A8DF', orden: 5, activa: true },
  { slug: 'escalada', nombre: 'Escalada', color: '#D9A514', orden: 6, activa: true },
] as const;

// ─── Declaración jurada por defecto ─────────────────────────────────────────────
// Texto exacto de la declaración vigente de Pamir (versión "2026-08", ver
// migración 20260823020000_categorias_senderismo). El texto no nombra a Pamir
// ni a ningún club en ningún punto — habla siempre de "la actividad" y "el
// grupo" en abstracto — así que se reutiliza byte-idéntico para todo club
// nuevo; no hay nada que parametrizar con el nombre del club todavía.

export const DEFAULT_DECLARACION_VERSION = '2026-08';

export const DEFAULT_DECLARACION_TITULO =
  'DECLARACIÓN JURADA DEL PARTICIPANTE — Declaro bajo mi responsabilidad que:';

export const DEFAULT_DECLARACION_ITEMS: readonly string[] = [
  'Me encuentro en condiciones físicas aptas para la actividad descrita. No tengo lesiones activas, ' +
    'enfermedades agudas ni condiciones de salud que comprometan mi seguridad o la del grupo.',
  'He informado al líder de la actividad sobre mis condiciones de salud, medicamentos y alergias ' +
    'relevantes, a través de mi ficha de socio.',
  'Cuento con el equipamiento mínimo exigido en la ficha técnica de esta actividad y sé utilizarlo ' +
    'correctamente.',
  'Tengo la experiencia señalada en el protocolo correspondiente al nivel de esta actividad, y la he ' +
    'declarado con veracidad en mi ficha de experiencia.',
  'Acepto y me comprometo a respetar las instrucciones del líder de la actividad en terreno, incluyendo ' +
    'la decisión de descenso preventivo si las condiciones lo ameritan.',
  'Entiendo que el incumplimiento de cualquiera de los requisitos de este protocolo puede resultar en mi ' +
    'exclusión de la actividad, sin derecho a reembolso de costos ya incurridos.',
  'Conozco los números de emergencia relevantes para la zona de la actividad y sé a quién llamar en caso ' +
    'de una emergencia.',
];

// Fórmula documentada en la migración 20260822120000_add_eventos_module:
// hash_sha256 = sha256(titulo + '\n' + items.join('\n')). Ver
// tenant-defaults.test.ts para la prueba que reproduce el literal ahí grabado.
export function computeDeclaracionHash(titulo: string, items: readonly string[]): string {
  return createHash('sha256').update(titulo + '\n' + items.join('\n')).digest('hex');
}

export interface DefaultDeclaracion {
  version: string;
  titulo: string;
  items: readonly string[];
  hashSha256: string;
}

// `org` se conserva en la firma (en vez de no recibir argumentos) para que,
// si algún día el texto necesita nombrar al club, ningún llamador tenga que
// cambiar — hoy no se usa: el texto vigente no nombra a ningún club.
export function buildDefaultDeclaracion(org: { name: string }): DefaultDeclaracion {
  void org;
  return {
    version: DEFAULT_DECLARACION_VERSION,
    titulo: DEFAULT_DECLARACION_TITULO,
    items: DEFAULT_DECLARACION_ITEMS,
    hashSha256: computeDeclaracionHash(DEFAULT_DECLARACION_TITULO, DEFAULT_DECLARACION_ITEMS),
  };
}
