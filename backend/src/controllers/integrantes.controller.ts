import { Request, Response } from 'express';
import { prisma } from '../lib/prisma.js';
import { sendEmail } from '../lib/google-gmail.js';
import { buildConfirmationEmail } from '../lib/email-templates.js';
import { ADMIN_EMAIL } from '../lib/constants.js';

interface CreateIntegranteBody {
  nombreCompleto: string;
  rut: string;
  nacionalidad: string;
  genero: string;
  fechaNacimiento: string;
  direccion: string;
  comuna: string;
  region: string;
  telefonoCelular: string;
  email: string;
  previsionSalud: string;
  nombreContacto: string;
  parentesco: string;
  telefonoContacto: string;
  grupoSanguineo: string;
  alergiasTiene: boolean;
  alergiasDetalle?: string;
  enfermedadesCronicasTiene: boolean;
  enfermedadesCronicasDetalle?: string;
  medicamentosTiene: boolean;
  medicamentosDetalle?: string;
  cirugiasLesionesTiene: boolean;
  cirugiasLesionesDetalle?: string;
  fuma: boolean;
  usaLentes: boolean;
  membresiaClub: string;
  nombreClub?: string;
  declaracionSalud: boolean;
  aceptacionRiesgo: boolean;
  consentimientoDatos: boolean;
  derechoImagen: boolean;
}

// POST /api/integrantes
export async function createIntegrante(req: Request, res: Response): Promise<void> {
  try {
    const data = req.body as CreateIntegranteBody;

    if (req.user!.email !== ADMIN_EMAIL && req.user!.email !== data.email) {
      res.status(403).json({ error: 'No autorizado para crear integrantes para otros usuarios' });
      return;
    }

    const existing = await prisma.integrante.findUnique({ where: { rut: data.rut } });
    if (existing) {
      res.status(409).json({ error: 'Ya existe un integrante registrado con ese RUT' });
      return;
    }

    const integrante = await prisma.integrante.create({
      data: {
        nombreCompleto: data.nombreCompleto,
        rut: data.rut,
        nacionalidad: data.nacionalidad,
        genero: data.genero,
        fechaNacimiento: new Date(data.fechaNacimiento),
        direccion: data.direccion,
        comuna: data.comuna,
        region: data.region,
        telefonoCelular: data.telefonoCelular,
        email: data.email,
        previsionSalud: data.previsionSalud,
        nombreContacto: data.nombreContacto,
        parentesco: data.parentesco,
        telefonoContacto: data.telefonoContacto,
        grupoSanguineo: data.grupoSanguineo,
        alergiasTiene: data.alergiasTiene,
        alergiasDetalle: data.alergiasDetalle ?? null,
        enfermedadesCronicasTiene: data.enfermedadesCronicasTiene,
        enfermedadesCronicasDetalle: data.enfermedadesCronicasDetalle ?? null,
        medicamentosTiene: data.medicamentosTiene,
        medicamentosDetalle: data.medicamentosDetalle ?? null,
        cirugiasLesionesTiene: data.cirugiasLesionesTiene,
        cirugiasLesionesDetalle: data.cirugiasLesionesDetalle ?? null,
        fuma: data.fuma,
        usaLentes: data.usaLentes,
        membresiaClub: data.membresiaClub,
        nombreClub: data.nombreClub ?? null,
        declaracionSalud: data.declaracionSalud,
        aceptacionRiesgo: data.aceptacionRiesgo,
        consentimientoDatos: data.consentimientoDatos,
        derechoImagen: data.derechoImagen,
      },
      select: {
        id: true,
        nombreCompleto: true,
        rut: true,
        email: true,
        createdAt: true,
      },
    });

    sendEmail(
      data.email,
      'Confirmación de registro — Pamir',
      buildConfirmationEmail(data),
    ).catch((err) => console.error('[email] Error al enviar confirmación:', err));

    res.status(201).json(integrante);
  } catch (error) {
    console.error('[createIntegrante]', error);
    res.status(500).json({ error: 'No se pudo registrar el integrante' });
  }
}

// GET /api/integrantes/me
export async function getMyIntegrante(req: Request, res: Response): Promise<void> {
  try {
    const email = req.user!.email;
    const integrante = await prisma.integrante.findFirst({
      where: { email },
      select: { id: true, nombreCompleto: true, rut: true, email: true, membresiaClub: true, createdAt: true },
    });
    if (!integrante) {
      res.status(404).json({ error: 'Sin ficha de integrante' });
      return;
    }
    res.json(integrante);
  } catch (error) {
    console.error('[getMyIntegrante]', error);
    res.status(500).json({ error: 'Error al verificar integrante' });
  }
}

// GET /api/integrantes/by-rut/:rut
export async function getIntegranteByRut(req: Request, res: Response): Promise<void> {
  try {
    const rut = decodeURIComponent(req.params.rut as string);

    const integrante = await prisma.integrante.findUnique({
      where: { rut },
      select: {
        id: true,
        nombreCompleto: true,
        rut: true,
        email: true,
        membresiaClub: true,
        nombreClub: true,
        createdAt: true,
      },
    });

    if (!integrante) {
      res.status(404).json({ error: 'Integrante no encontrado' });
      return;
    }

    res.json(integrante);
  } catch (error) {
    console.error('[getIntegranteByRut]', error);
    res.status(500).json({ error: 'Error al buscar integrante' });
  }
}
