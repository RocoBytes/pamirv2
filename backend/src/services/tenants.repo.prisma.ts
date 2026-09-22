// Implementación real (Prisma) de TenantsRepo. Mantenida separada del
// servicio (tenants.service.ts) para que la lógica de negocio se pueda
// probar con un repositorio en memoria, sin tocar la base de datos — mismo
// patrón que invitaciones.repo.prisma.ts.
//
// No importa runAsPlatform/runWithOrganization: se asume que quien llama
// (scripts/tenant.ts, o la sección correspondiente de test-isolation.ts) ya
// estableció el contexto de tenant correcto antes de invocar estas funciones
// (contexto de plataforma para todo lo de acá, salvo la invitación del primer
// ADMIN, que vive en tenants.service.ts / invitaciones.service.ts).
import { prisma } from '../lib/prisma.js';
import { Prisma, type OrganizationStatus } from '../generated/prisma/client.js';
import type {
  TenantsRepo,
  OrganizationRow,
  CrearClubData,
  CrearClubTransaccionResult,
  ClubListRow,
  ActualizarClubData,
} from './tenants.service.js';
import type { DEFAULT_CATEGORIAS_EVENTO, buildDefaultDeclaracion } from '../lib/tenant-defaults.js';

const asJson = (v: unknown): Prisma.InputJsonValue => v as Prisma.InputJsonValue;

interface OrganizationRecord {
  id: string;
  slug: string;
  name: string;
  shortName: string | null;
  status: OrganizationStatus;
  membresiaPropia: string;
  alertEmail: string;
  contactName: string;
  contactEmail: string;
  createdAt: Date;
}

function toOrganizationRow(org: OrganizationRecord): OrganizationRow {
  return {
    id: org.id,
    slug: org.slug,
    name: org.name,
    shortName: org.shortName,
    status: org.status,
    membresiaPropia: org.membresiaPropia,
    alertEmail: org.alertEmail,
    contactName: org.contactName,
    contactEmail: org.contactEmail,
    createdAt: org.createdAt,
  };
}

export const tenantsRepoPrisma: TenantsRepo = {
  async findOrganizationBySlug(slug) {
    const organization = await prisma.organization.findUnique({ where: { slug } });
    return organization ? toOrganizationRow(organization) : null;
  },

  async findOrganizationByMembresia(membresiaPropia) {
    const organization = await prisma.organization.findFirst({ where: { membresiaPropia } });
    return organization ? toOrganizationRow(organization) : null;
  },

  async crearClubTransaccion(
    data: CrearClubData,
    categorias: typeof DEFAULT_CATEGORIAS_EVENTO,
    declaracion: ReturnType<typeof buildDefaultDeclaracion>,
  ): Promise<CrearClubTransaccionResult> {
    return prisma.$transaction(async (tx) => {
      const organization = await tx.organization.create({
        data: {
          slug: data.slug,
          name: data.name,
          shortName: data.shortName,
          membresiaPropia: data.membresiaPropia,
          alertEmail: data.alertEmail,
          contactName: data.contactName,
          contactEmail: data.contactEmail,
        },
      });

      const { count: categoriasCreadas } = await tx.categoriaEvento.createMany({
        data: categorias.map((categoria) => ({
          organizationId: organization.id,
          slug: categoria.slug,
          nombre: categoria.nombre,
          color: categoria.color,
          orden: categoria.orden,
          activa: categoria.activa,
        })),
      });

      await tx.declaracionJuradaVersion.create({
        data: {
          organizationId: organization.id,
          version: declaracion.version,
          titulo: declaracion.titulo,
          items: asJson(declaracion.items),
          hashSha256: declaracion.hashSha256,
          // vigenteHasta queda null (su default): es la declaración vigente
          // del club recién creado.
        },
      });

      return { organization: toOrganizationRow(organization), categoriasCreadas };
    });
  },

  async listOrganizations(): Promise<ClubListRow[]> {
    const now = new Date();
    const [organizations, pendingCounts] = await Promise.all([
      prisma.organization.findMany({
        orderBy: { createdAt: 'asc' },
        include: { _count: { select: { users: true } } },
      }),
      // Invitación "pendiente" = ni aceptada, ni revocada, ni expirada — el
      // mismo criterio que estadoInvitacion() en lib/invitaciones.ts, pero
      // agrupado por club en vez de evaluado fila por fila.
      prisma.invitacion.groupBy({
        by: ['organizationId'],
        where: { aceptadaAt: null, revocadaAt: null, expiresAt: { gt: now } },
        _count: { _all: true },
      }),
    ]);

    const pendingByOrg = new Map(pendingCounts.map((row) => [row.organizationId, row._count._all]));

    return organizations.map((organization) => ({
      slug: organization.slug,
      name: organization.name,
      status: organization.status,
      membresiaPropia: organization.membresiaPropia,
      userCount: organization._count.users,
      pendingInvitationCount: pendingByOrg.get(organization.id) ?? 0,
      createdAt: organization.createdAt,
    }));
  },

  async updateOrganizationStatus(id, status) {
    const organization = await prisma.organization.update({ where: { id }, data: { status } });
    return toOrganizationRow(organization);
  },

  async updateOrganization(id: string, data: ActualizarClubData): Promise<OrganizationRow> {
    const organization = await prisma.organization.update({ where: { id }, data });
    return toOrganizationRow(organization);
  },
};
