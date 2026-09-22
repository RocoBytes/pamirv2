// Vistas públicas de Organization: nunca exponen alertEmail/contactName/
// contactEmail (uso interno para enviar correo "como" el club — ver
// email-templates.ts), y toPublicOrganizationBrand ni siquiera expone
// membresiaPropia/id, porque se usa en pantallas SIN sesión (login previo a
// autenticar, consultar invitación, evaluación express).
//
// hasLogo/logoVersion se derivan acá, en un solo lugar, a partir de
// logoObjectKey — la clave cruda del objeto en el bucket NUNCA se serializa
// (ver GET /api/clubes/:slug/logo, que sirve los bytes por su cuenta).

import { createHash } from 'node:crypto';

export interface PublicOrganization {
  id: string;
  slug: string;
  name: string;
  shortName: string | null;
  membresiaPropia: string;
  hasLogo: boolean;
  logoVersion: string | null;
}

export interface PublicOrganizationBrand {
  slug: string;
  name: string;
  shortName: string | null;
  hasLogo: boolean;
  logoVersion: string | null;
}

type FullSource = Pick<PublicOrganization, 'id' | 'slug' | 'name' | 'shortName' | 'membresiaPropia'> & {
  logoObjectKey: string | null;
};
type BrandSource = Pick<PublicOrganizationBrand, 'slug' | 'name' | 'shortName'> & {
  logoObjectKey: string | null;
};

// Primeros 8 caracteres del sha256 de la clave del objeto: determinístico,
// cambia en cada subida (buildObjectKey genera un uuid nuevo por reemplazo) y
// nunca permite reconstruir la clave real. Viaja en la URL del logo
// (?v=<logoVersion>) para poder cachearla para siempre — ver
// GET /api/clubes/:slug/logo.
export function logoVersionOf(logoObjectKey: string | null): string | null {
  if (!logoObjectKey) return null;
  return createHash('sha256').update(logoObjectKey).digest('hex').slice(0, 8);
}

// Usado por login/getMe: el usuario ya está autenticado en este club, así que
// membresiaPropia (necesaria para esSocioDelClub en el frontend) es segura.
export function toPublicOrganization(org: FullSource): PublicOrganization {
  return {
    id: org.id,
    slug: org.slug,
    name: org.name,
    shortName: org.shortName,
    membresiaPropia: org.membresiaPropia,
    hasLogo: org.logoObjectKey !== null,
    logoVersion: logoVersionOf(org.logoObjectKey),
  };
}

// Usado por pantallas públicas (consultar invitación, evaluación express,
// login previo a autenticar): alcanza con lo mínimo para pintar el logo y el
// nombre del club.
export function toPublicOrganizationBrand(org: BrandSource): PublicOrganizationBrand {
  return {
    slug: org.slug,
    name: org.name,
    shortName: org.shortName,
    hasLogo: org.logoObjectKey !== null,
    logoVersion: logoVersionOf(org.logoObjectKey),
  };
}
