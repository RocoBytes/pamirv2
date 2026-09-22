// Códigos de membresía de club (espejo del enum MembresiaClub del frontend).
// Antes vivía como una constante privada en controllers/admin.controller.ts
// (el filtro de club del dashboard); se mueve acá para que
// services/tenants.service.ts pueda reutilizarla sin crear una dependencia
// cruzada entre un servicio y un controlador.
export const MEMBRESIA_CLUBS = [
    'SOCIO_ANDINO_PAMIR',
    'SOCIO_EL_MONTANISTA',
    'SOCIO_OTRO_CLUB',
    'POSTULANTE_CLUB',
    'NO_PERTENECE',
];
// Subconjunto de MEMBRESIA_CLUBS válido como Organization.membresiaPropia (el
// código que identifica a un socio de ESE club — ver
// lib/documentos-access.ts). Nunca 'SOCIO_OTRO_CLUB', 'POSTULANTE_CLUB' ni
// 'NO_PERTENECE': son estados que un socio declara sobre SU PROPIA
// afiliación, no la identidad de un club. Si un código así fuera la
// membresía propia de un club, cualquier socio "de otro club"/"postulante"/
// "no pertenece" caería, sin quererlo, dentro de la biblioteca de ese club.
//
// LÍMITE DEL PUENTE (bridge): hoy solo existen dos clubes reales y cada uno
// necesita su propio código exclusivo (Organization.membresiaPropia no es
// única en la base de datos — ver tenants.service.ts). Dar de alta un TERCER
// club requiere agregar su código acá Y en las listas del frontend
// (MembresiaClub del formulario de socios y del filtro de administración).
export const MEMBRESIAS_PROPIAS = ['SOCIO_ANDINO_PAMIR', 'SOCIO_EL_MONTANISTA'];
