// Códigos de membresía de club (espejo del enum MembresiaClub del frontend).
// Antes vivía como una constante privada en controllers/admin.controller.ts
// (el filtro de club del dashboard); se mueve acá para que
// services/tenants.service.ts pueda reutilizarla sin crear una dependencia
// cruzada entre un servicio y un controlador.
export const MEMBRESIA_CLUBS = [
  'SOCIO_ANDINO_PAMIR',
  'SOCIO_EL_MONTANISTA',
  'SOCIO_ANDINO_TESTING',
  'SOCIO_RIALA',
  'SOCIO_OTRO_CLUB',
  'POSTULANTE_CLUB',
  'NO_PERTENECE',
] as const;

export type MembresiaClub = (typeof MEMBRESIA_CLUBS)[number];

// Subconjunto de MEMBRESIA_CLUBS válido como Organization.membresiaPropia (el
// código que identifica a un socio de ESE club — ver
// lib/documentos-access.ts). Nunca 'SOCIO_OTRO_CLUB', 'POSTULANTE_CLUB' ni
// 'NO_PERTENECE': son estados que un socio declara sobre SU PROPIA
// afiliación, no la identidad de un club. Si un código así fuera la
// membresía propia de un club, cualquier socio "de otro club"/"postulante"/
// "no pertenece" caería, sin quererlo, dentro de la biblioteca de ese club.
//
// LÍMITE DEL PUENTE (bridge): cada club necesita su propio código exclusivo
// (Organization.membresiaPropia no es única en la base de datos — ver
// tenants.service.ts, que valida la unicidad a mano). Dar de alta un club
// nuevo NO es solo correr el CLI: hay que agregar su código acá Y en las
// listas del frontend (la unión MembresiaClub, CLUB_BADGE_LABELS y
// CLUB_FILTER_LABELS en types/salida.ts, y el z.enum del paso 3 del wizard),
// y desplegar ese cambio ANTES de poder crear el club.
export const MEMBRESIAS_PROPIAS = [
  'SOCIO_ANDINO_PAMIR',
  'SOCIO_EL_MONTANISTA',
  'SOCIO_ANDINO_TESTING',
  'SOCIO_RIALA',
] as const;

export type MembresiaPropia = (typeof MEMBRESIAS_PROPIAS)[number];
