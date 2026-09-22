// Asuntos de correo, extraídos de los controladores para poder probarlos sin
// levantar Express ni Prisma. Solo llevan branding cuando el texto original
// mencionaba la marca fija del sistema; los demás quedan igual que antes.
import type { OrgBranding } from '../email-templates.js';
import { rangoFechasEvento } from '../email-templates.js';

export function subjectPasswordReset(branding: OrgBranding): string {
  return `Restablece tu contraseña — ${branding.shortName}`;
}

export function subjectConfirmacionRegistro(branding: OrgBranding): string {
  return `Confirmación de registro — ${branding.shortName}`;
}

export function subjectRegistroSalida(branding: OrgBranding, nombreActividad: string): string {
  return `Has sido registrado en la salida "${nombreActividad}" — ${branding.shortName}`;
}

export function subjectCierre(branding: OrgBranding, nombreActividad: string): string {
  return `Cierre de la salida "${nombreActividad}" — ${branding.shortName}`;
}

export function subjectRecordatorioCierre(nombreActividad: string): string {
  return `Recordatorio: cierra tu salida — ${nombreActividad}`;
}

export function subjectAlertaSalida(nombreActividad: string): string {
  return `ALERTA: Salida sin cierre — ${nombreActividad}`;
}

export function subjectSaludSalida(nombreActividad: string): string {
  return `Resumen de fichas de salud — ${nombreActividad}`;
}

export function subjectInvitacion(branding: OrgBranding): string {
  return `Te invitaron a ${branding.shortName}`;
}

interface EventoSubjectData {
  titulo: string;
  fechaInicio: Date | null;
  fechaFin: Date | null;
}

export function subjectEventoInscripcionConfirmada(evento: EventoSubjectData): string {
  return `Recibimos tu postulación: ${evento.titulo}`;
}

export function subjectEventoSeleccionado(evento: EventoSubjectData): string {
  return `Quedaste seleccionado/a: ${evento.titulo} · ${rangoFechasEvento(evento)}`;
}

export function subjectEventoNoSeleccionado(evento: EventoSubjectData): string {
  return `Resultado de tu postulación: ${evento.titulo}`;
}

export function subjectEventoCancelado(evento: EventoSubjectData): string {
  return `Evento cancelado: ${evento.titulo}`;
}
