import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  brandingFor,
  buildSalidaNotificationEmail,
  buildCierreNotificationEmail,
  buildConfirmationEmail,
  buildAlertaSalidaEmail,
  buildRecordatorioCierreEmail,
  buildSaludSalidaEmail,
  buildVerificationEmail,
  buildPasswordResetEmail,
  buildInvitationEmail,
  buildEventoInscripcionConfirmadaEmail,
  buildEventoSeleccionadoEmail,
  buildEventoNoSeleccionadoEmail,
  buildEventoCanceladoEmail,
} from './email-templates.js';
import type { OrganizationSummary } from '../types/index.js';

const org: OrganizationSummary = {
  id: 'org-1',
  slug: 'el-montanista',
  name: 'Club El Montañista',
  shortName: 'El Montañista',
  membresiaPropia: 'SOCIO_EL_MONTANISTA',
  alertEmail: 'alertas@elmontanista.cl',
  contactName: 'Secretaría El Montañista',
  contactEmail: 'contacto@elmontanista.cl',
  logoObjectKey: null,
};

const branding = brandingFor(org);

function assertNoPamir(html: string): void {
  assert.equal(/pamir/i.test(html), false, 'no debe mencionar "Pamir"');
}

function assertMentionsClub(html: string): void {
  assert.equal(html.includes(branding.name), true, 'debe mencionar el nombre del club');
}

function assertHasContactLine(html: string): void {
  assert.equal(html.includes(branding.contactEmail), true, 'debe incluir el correo de contacto del club');
}

function assertNoContactLine(html: string): void {
  assert.equal(html.includes(branding.contactEmail), false, 'no debe incluir un correo de contacto');
}

// ─── Fixtures mínimas y válidas por tipo de parámetro ─────────────────────────

const salida = {
  nombreActividad: 'Cerro Plomo',
  tipoSalida: 'OFICIAL_CLUB',
  disciplina: 'ALTA_MONTANA',
  ubicacionGeografica: 'Farellones',
  fechaInicio: '2026-11-01',
  fechaRetornoEstimada: '2026-11-02',
  horaRetornoEstimada: '18:00',
  horaAlerta: '20:00',
  avisosExternos: [],
  liderCordada: 'Ana Pérez',
  participantes: [],
  coordinacionGrupal: true,
  matrizRiesgos: true,
  mediosComunicacion: [],
  equipoColectivo: [],
  riesgosIdentificados: [],
};

const cierre = {
  fechaFinalizacionReal: '2026-11-02',
  estadoCierre: 'COMPLETADA_SEGUN_PLAN',
  huboCambios: 'NO',
  ocurrioIncidente: 'NO',
  ocurrioAccidente: 'NO',
  desempenoEquipo: 'TODO_FUNCIONO',
  observacionesRuta: 'Sin novedad',
  precisionPronostico: 4,
  leccionesAprendidas: 'Ninguna',
};

const integrante = {
  nombreCompleto: 'Juan Soto',
  rut: '11.111.111-1',
  nacionalidad: 'Chilena',
  genero: 'MASCULINO',
  fechaNacimiento: '1990-01-01',
  direccion: 'Calle 1',
  comuna: 'Providencia',
  region: 'RM',
  telefonoCelular: '+56911111111',
  email: 'juan@example.com',
  previsionSalud: 'Fonasa',
  nombreContacto: 'María Soto',
  parentesco: 'Madre',
  telefonoContacto: '+56922222222',
  grupoSanguineo: 'O+',
  alergiasTiene: false,
  enfermedadesCronicasTiene: false,
  medicamentosTiene: false,
  cirugiasLesionesTiene: false,
  fuma: false,
  usaLentes: false,
  declaracionSalud: true,
  aceptacionRiesgo: true,
  consentimientoDatos: true,
  derechoImagen: true,
};

const alertaSalida = {
  nombreActividad: 'Cerro Plomo',
  ubicacionGeografica: 'Farellones',
  fechaInicio: '2026-11-01',
  fechaRetornoEstimada: '2026-11-02',
  horaRetornoEstimada: '18:00',
  horaAlerta: '20:00',
  liderCordada: 'Ana Pérez',
  participantes: [],
};

const participantesSalud = [{ rut: '11.111.111-1', nombre: 'Juan Soto', fichaEncontrada: false }];

const invitationData = {
  invitadoPorNombre: 'Ana Pérez',
  rolLabel: 'Socio',
  inviteUrl: 'https://app.example.com/#invite=abc',
  expiraEnDias: 7,
};

const evento = {
  titulo: 'Cerro Plomo',
  fechaInicio: new Date('2026-11-01T00:00:00Z'),
  fechaFin: null,
  fechaCorte: null,
  ubicacion: 'Farellones',
};

const inscripcion = { tieneVehiculo: false, cuposVehiculo: null };

const eventoLifecycle = {
  titulo: 'Cerro Plomo',
  fechaInicio: new Date('2026-11-01T00:00:00Z'),
  fechaFin: null,
  horaInicio: null,
  ubicacion: 'Farellones',
  reunionCoordinacion: null,
  organizadorNombre: null,
  motivoCancelacion: null,
};

describe('email-templates — branding por club en cada builder', () => {
  it('buildSalidaNotificationEmail', () => {
    const html = buildSalidaNotificationEmail('Juan Soto', salida, branding);
    assertMentionsClub(html);
    assertHasContactLine(html);
    assertNoPamir(html);
  });

  it('buildCierreNotificationEmail (sin evaluación)', () => {
    const html = buildCierreNotificationEmail('Juan Soto', salida, cierre, branding);
    assertMentionsClub(html);
    assertHasContactLine(html);
    assertNoPamir(html);
  });

  it('buildCierreNotificationEmail (con evaluación)', () => {
    const html = buildCierreNotificationEmail('Juan Soto', salida, cierre, branding, 'https://app.elmontanista.cl?evaluacion=tok');
    assertMentionsClub(html);
    assertHasContactLine(html);
    assert.equal(html.includes('https://app.elmontanista.cl?evaluacion=tok'), true);
    assertNoPamir(html);
  });

  it('buildConfirmationEmail', () => {
    const html = buildConfirmationEmail(integrante, branding);
    assertMentionsClub(html);
    assertHasContactLine(html);
    assertNoPamir(html);
  });

  it('buildAlertaSalidaEmail', () => {
    const html = buildAlertaSalidaEmail(alertaSalida, branding);
    assertMentionsClub(html);
    assertHasContactLine(html);
    assertNoPamir(html);
  });

  it('buildRecordatorioCierreEmail', () => {
    const html = buildRecordatorioCierreEmail(alertaSalida, branding);
    assertMentionsClub(html);
    assertHasContactLine(html);
    assertNoPamir(html);
  });

  it('buildSaludSalidaEmail', () => {
    const html = buildSaludSalidaEmail('Cerro Plomo', 'Ana Pérez', participantesSalud, branding);
    assertMentionsClub(html);
    assertHasContactLine(html);
    assert.equal(html.includes(branding.name), true);
    assertNoPamir(html);
  });

  it('buildVerificationEmail (sin línea de contacto)', () => {
    const html = buildVerificationEmail('Juan Soto', 'https://app.elmontanista.cl?verify=tok', branding);
    assertMentionsClub(html);
    assertNoContactLine(html);
    assert.equal(html.includes('https://app.elmontanista.cl?verify=tok'), true);
    assertNoPamir(html);
  });

  it('buildPasswordResetEmail (sin línea de contacto)', () => {
    const html = buildPasswordResetEmail('Juan Soto', 'https://app.elmontanista.cl?reset=tok', branding);
    assertMentionsClub(html);
    assertNoContactLine(html);
    assert.equal(html.includes('https://app.elmontanista.cl?reset=tok'), true);
    assertNoPamir(html);
  });

  it('buildInvitationEmail', () => {
    const html = buildInvitationEmail(invitationData, branding);
    assertMentionsClub(html);
    assertHasContactLine(html);
    assert.equal(html.includes(invitationData.inviteUrl), true);
    assertNoPamir(html);
  });

  it('buildEventoInscripcionConfirmadaEmail usa branding.frontendUrl en el CTA', () => {
    const html = buildEventoInscripcionConfirmadaEmail('Juan Soto', evento, inscripcion, branding);
    assertMentionsClub(html);
    assertHasContactLine(html);
    assert.equal(html.includes(branding.frontendUrl), true);
    assertNoPamir(html);
  });

  it('buildEventoSeleccionadoEmail usa branding.frontendUrl en el CTA', () => {
    const html = buildEventoSeleccionadoEmail('Juan Soto', eventoLifecycle, branding);
    assertMentionsClub(html);
    assertHasContactLine(html);
    assert.equal(html.includes(branding.frontendUrl), true);
    assertNoPamir(html);
  });

  it('buildEventoNoSeleccionadoEmail usa branding.frontendUrl en el CTA', () => {
    const html = buildEventoNoSeleccionadoEmail('Juan Soto', eventoLifecycle, { cupos: 10, postulantes: 20 }, branding);
    assertMentionsClub(html);
    assertHasContactLine(html);
    assert.equal(html.includes(branding.frontendUrl), true);
    assertNoPamir(html);
  });

  it('buildEventoCanceladoEmail usa branding.frontendUrl en el CTA', () => {
    const html = buildEventoCanceladoEmail('Juan Soto', eventoLifecycle, branding);
    assertMentionsClub(html);
    assertHasContactLine(html);
    assert.equal(html.includes(branding.frontendUrl), true);
    assertNoPamir(html);
  });
});

// ─── Verificación estática: ningún archivo fuente sigue mencionando Pamir o Gmail ──

function listTsFilesRecursive(dir: string): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      if (entry === 'generated' || entry === 'node_modules') continue;
      files.push(...listTsFilesRecursive(fullPath));
    } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) {
      files.push(fullPath);
    }
  }
  return files;
}

describe('sin restos de la marca Pamir ni del proveedor Gmail en el código fuente', () => {
  const srcDir = join(import.meta.dirname, '..');
  const files = listTsFilesRecursive(srcDir);

  it('ningún archivo (fuera de tests) contiene el literal "— Pamir"', () => {
    const offenders = files.filter((f) => readFileSync(f, 'utf8').includes('— Pamir'));
    assert.deepEqual(offenders, []);
  });

  it('ningún archivo (fuera de tests) importa google-gmail', () => {
    const offenders = files.filter((f) => readFileSync(f, 'utf8').includes('google-gmail'));
    assert.deepEqual(offenders, []);
  });
});
