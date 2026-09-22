// Vistas públicas de Organization: nunca exponen alertEmail/contactName/
// contactEmail (uso interno para enviar correo "como" el club — ver
// email-templates.ts), y toPublicOrganizationBrand ni siquiera expone
// membresiaPropia/id, porque se usa en pantallas SIN sesión (login previo a
// autenticar, consultar invitación, evaluación express).

export interface PublicOrganization {
  id: string;
  slug: string;
  name: string;
  shortName: string | null;
  membresiaPropia: string;
}

export interface PublicOrganizationBrand {
  slug: string;
  name: string;
  shortName: string | null;
}

type FullSource = Pick<PublicOrganization, 'id' | 'slug' | 'name' | 'shortName' | 'membresiaPropia'>;
type BrandSource = Pick<PublicOrganizationBrand, 'slug' | 'name' | 'shortName'>;

// Usado por login/getMe: el usuario ya está autenticado en este club, así que
// membresiaPropia (necesaria para esSocioDelClub en el frontend) es segura.
export function toPublicOrganization(org: FullSource): PublicOrganization {
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
export function toPublicOrganizationBrand(org: BrandSource): PublicOrganizationBrand {
  return {
    slug: org.slug,
    name: org.name,
    shortName: org.shortName,
  };
}
