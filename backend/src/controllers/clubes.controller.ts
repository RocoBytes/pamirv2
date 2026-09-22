import { Request, Response } from 'express';
import { prisma } from '../lib/prisma.js';
import { runAsPlatform } from '../lib/tenant-context.js';
import { getFileStorage } from '../lib/storage/get-file-storage.js';
import { toPublicOrganizationBrand } from '../lib/serializers/organization.js';

/**
 * GET /api/clubes/:slug/marca
 *
 * Público (sin sesión): lo mínimo para pintar el logo y el nombre del club
 * antes de autenticar — ver AuthPage. No pasa por authMiddleware, así que no
 * hay contexto de tenant: la búsqueda corre en contexto de plataforma, igual
 * que consultarInvitacion/getEvaluacion.
 */
// GCS devuelve un etag opaco y sin comillas, pero un ETag fuerte de HTTP va
// entre comillas: sin ellas, un intermediario que lo normalice (Cloudflare)
// rompe la revalidación y el navegador vuelve a bajar la imagen entera.
export function quoteEtag(raw: string): string {
  return /^(W\/)?".*"$/.test(raw) ? raw : `"${raw}"`;
}

// If-None-Match puede traer varios etags separados por coma, y un
// intermediario puede debilitarlos con el prefijo W/. Se comparan sin ese
// prefijo: para una imagen inmutable, débil y fuerte significan lo mismo.
export function etagMatches(ifNoneMatch: string | undefined, etag: string): boolean {
  if (!ifNoneMatch) return false;
  const strip = (value: string) => value.trim().replace(/^W\//, '');
  return ifNoneMatch.split(',').some((candidate) => strip(candidate) === strip(etag));
}

export async function getClubMarca(req: Request, res: Response): Promise<void> {
  const slug = req.params.slug as string;

  try {
    const org = await runAsPlatform(() =>
      prisma.organization.findUnique({
        where: { slug },
        select: { slug: true, name: true, shortName: true, logoObjectKey: true },
      }),
    );

    if (!org) {
      res.status(404).json({ error: 'Club no encontrado' });
      return;
    }

    res.json(toPublicOrganizationBrand(org));
  } catch (error) {
    console.error('[getClubMarca]', error);
    res.status(500).json({ error: 'Error al obtener la marca del club' });
  }
}

/**
 * GET /api/clubes/:slug/logo
 *
 * Público (sin sesión): los bytes del logo, servidos desde el backend en vez
 * de con una URL firmada — ver la excepción anotada en CLAUDE.md §1. Nunca
 * bufferiza el archivo completo: el stream del storage se canaliza directo a
 * la respuesta.
 *
 * Con ?v=<logoVersion> (la URL cambia sola en cada subida) se cachea para
 * siempre; sin ese parámetro, cachea 5 minutos y honra If-None-Match.
 */
export async function getClubLogo(req: Request, res: Response): Promise<void> {
  const slug = req.params.slug as string;

  try {
    const org = await runAsPlatform(() =>
      prisma.organization.findUnique({ where: { slug }, select: { logoObjectKey: true } }),
    );

    if (!org || !org.logoObjectKey) {
      res.status(404).json({ error: 'Este club no tiene un logo propio' });
      return;
    }

    const storage = getFileStorage();
    const metadata = await storage.readMetadata(org.logoObjectKey);
    if (!metadata) {
      // El club tiene una clave guardada pero el objeto ya no está en el
      // bucket: es una inconsistencia real (huérfano borrado por fuera del
      // flujo normal), no un 404 esperable — se deja registrado además de
      // responder.
      console.error(
        `[getClubLogo] logoObjectKey "${org.logoObjectKey}" del club "${slug}" no existe en el storage`,
      );
      res.status(404).json({ error: 'Este club no tiene un logo propio' });
      return;
    }

    res.setHeader('Content-Type', metadata.contentType);
    const etag = quoteEtag(metadata.etag);
    res.setHeader('ETag', etag);

    const version = req.query['v'];
    if (typeof version === 'string' && version.length > 0) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    } else {
      res.setHeader('Cache-Control', 'public, max-age=300');
      if (etagMatches(req.headers['if-none-match'], etag)) {
        res.status(304).end();
        return;
      }
    }

    const readStream = storage.createReadStream(org.logoObjectKey);
    readStream.on('error', (err) => {
      console.error('[getClubLogo] Error leyendo el logo del storage:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Error al obtener el logo' });
      } else {
        res.destroy();
      }
    });
    readStream.pipe(res);
  } catch (error) {
    console.error('[getClubLogo]', error);
    res.status(500).json({ error: 'Error al obtener el logo' });
  }
}
