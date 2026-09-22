// Vistas públicas de Organization: nunca exponen alertEmail/contactName/
// contactEmail (uso interno para enviar correo "como" el club — ver
// email-templates.ts), y toPublicOrganizationBrand ni siquiera expone
// membresiaPropia/id, porque se usa en pantallas SIN sesión (login previo a
// autenticar, consultar invitación, evaluación express).
// Usado por login/getMe: el usuario ya está autenticado en este club, así que
// membresiaPropia (necesaria para esSocioDelClub en el frontend) es segura.
export function toPublicOrganization(org) {
    return {
        id: org.id,
        slug: org.slug,
        name: org.name,
        shortName: org.shortName,
        membresiaPropia: org.membresiaPropia,
    };
}
// Usado por pantallas públicas (consultar invitación, evaluación express):
// alcanza con lo mínimo para pintar el logo y el nombre del club.
export function toPublicOrganizationBrand(org) {
    return {
        slug: org.slug,
        name: org.name,
        shortName: org.shortName,
    };
}
