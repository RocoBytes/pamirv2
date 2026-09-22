import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { OrgBranding } from '../email-templates.js';
import {
  subjectPasswordReset,
  subjectConfirmacionRegistro,
  subjectRegistroSalida,
  subjectCierre,
  subjectRecordatorioCierre,
  subjectAlertaSalida,
  subjectSaludSalida,
  subjectInvitacion,
  subjectEventoInscripcionConfirmada,
  subjectEventoSeleccionado,
  subjectEventoNoSeleccionado,
  subjectEventoCancelado,
} from './subjects.js';

const branding: OrgBranding = {
  name: 'Club El Montañista',
  shortName: 'El Montañista',
  contactName: 'Secretaría',
  contactEmail: 'contacto@elmontanista.cl',
  frontendUrl: 'https://app.elmontanista.cl',
};

const evento = { titulo: 'Cerro Plomo', fechaInicio: new Date('2026-11-01T00:00:00Z'), fechaFin: null };

describe('subjects', () => {
  it('subjectPasswordReset usa el shortName del club', () => {
    assert.equal(subjectPasswordReset(branding), 'Restablece tu contraseña — El Montañista');
  });

  it('subjectConfirmacionRegistro usa el shortName del club', () => {
    assert.equal(subjectConfirmacionRegistro(branding), 'Confirmación de registro — El Montañista');
  });

  it('subjectRegistroSalida incluye el nombre de la actividad y el shortName', () => {
    assert.equal(
      subjectRegistroSalida(branding, 'Cerro Plomo'),
      'Has sido registrado en la salida "Cerro Plomo" — El Montañista',
    );
  });

  it('subjectCierre incluye el nombre de la actividad y el shortName', () => {
    assert.equal(subjectCierre(branding, 'Cerro Plomo'), 'Cierre de la salida "Cerro Plomo" — El Montañista');
  });

  it('subjectRecordatorioCierre no depende de la marca del club', () => {
    assert.equal(subjectRecordatorioCierre('Cerro Plomo'), 'Recordatorio: cierra tu salida — Cerro Plomo');
  });

  it('subjectAlertaSalida no depende de la marca del club', () => {
    assert.equal(subjectAlertaSalida('Cerro Plomo'), 'ALERTA: Salida sin cierre — Cerro Plomo');
  });

  it('subjectSaludSalida no depende de la marca del club', () => {
    assert.equal(subjectSaludSalida('Cerro Plomo'), 'Resumen de fichas de salud — Cerro Plomo');
  });

  it('subjectInvitacion usa el shortName del club (nunca la marca fija del sistema)', () => {
    assert.equal(subjectInvitacion(branding), 'Te invitaron a El Montañista');
  });

  it('subjectEventoInscripcionConfirmada incluye el título del evento', () => {
    assert.equal(subjectEventoInscripcionConfirmada(evento), 'Recibimos tu postulación: Cerro Plomo');
  });

  it('subjectEventoSeleccionado incluye el título y el rango de fechas', () => {
    assert.equal(subjectEventoSeleccionado(evento), 'Quedaste seleccionado/a: Cerro Plomo · 01-11-2026');
  });

  it('subjectEventoNoSeleccionado incluye el título del evento', () => {
    assert.equal(subjectEventoNoSeleccionado(evento), 'Resultado de tu postulación: Cerro Plomo');
  });

  it('subjectEventoCancelado incluye el título del evento', () => {
    assert.equal(subjectEventoCancelado(evento), 'Evento cancelado: Cerro Plomo');
  });
});
