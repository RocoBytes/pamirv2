import { prisma } from './prisma.js';
import { gestionaTodasLasCategorias } from './authz.js';

// Categorías de eventos que un usuario gestiona. Un LIDER gestiona todas las
// del club (incluidas las inactivas: un evento de una categoría dada de baja
// sigue debiendo poder editarse o cerrarse; el formulario de creación solo
// lista las activas porque GET /categorias filtra activa: true). CategoriaEvento
// está en TENANT_MODELS (lib/scope-args.ts), así que Prisma ya filtra por
// club vía el contexto de tenant (lib/tenant-context.ts) — no hace falta un
// where organizationId manual acá, igual que en el resto del código.
// Cualquier otro usuario solo gestiona las categorías asignadas a mano en
// gestores_categoria.
export async function categoriasGestionadas(
  user: { id: string; rol?: string | null } | null | undefined,
): Promise<{ categoriaId: number; slug: string }[]> {
  if (!user) return [];

  if (gestionaTodasLasCategorias(user)) {
    const categorias = await prisma.categoriaEvento.findMany({
      select: { id: true, slug: true },
      orderBy: { id: 'asc' },
    });
    return categorias.map((c) => ({ categoriaId: c.id, slug: c.slug }));
  }

  const filas = await prisma.gestorCategoria.findMany({
    where: { usuarioId: user.id },
    select: { categoriaId: true, categoria: { select: { slug: true } } },
    orderBy: { categoriaId: 'asc' },
  });
  return filas.map((f) => ({ categoriaId: f.categoriaId, slug: f.categoria.slug }));
}
