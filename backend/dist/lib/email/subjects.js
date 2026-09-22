import { rangoFechasEvento } from '../email-templates.js';
export function subjectPasswordReset(branding) {
    return `Restablece tu contraseña — ${branding.name}`;
}
export function subjectConfirmacionRegistro(branding) {
    return `Confirmación de registro — ${branding.name}`;
}
export function subjectRegistroSalida(branding, nombreActividad) {
    return `Has sido registrado en la salida "${nombreActividad}" — ${branding.name}`;
}
export function subjectCierre(branding, nombreActividad) {
    return `Cierre de la salida "${nombreActividad}" — ${branding.name}`;
}
export function subjectRecordatorioCierre(nombreActividad) {
    return `Recordatorio: cierra tu salida — ${nombreActividad}`;
}
export function subjectAlertaSalida(nombreActividad) {
    return `ALERTA: Salida sin cierre — ${nombreActividad}`;
}
export function subjectSaludSalida(nombreActividad) {
    return `Resumen de fichas de salud — ${nombreActividad}`;
}
export function subjectInvitacion(branding) {
    return `Te invitaron a ${branding.name}`;
}
export function subjectEventoInscripcionConfirmada(evento) {
    return `Recibimos tu postulación: ${evento.titulo}`;
}
export function subjectEventoSeleccionado(evento) {
    return `Quedaste seleccionado/a: ${evento.titulo} · ${rangoFechasEvento(evento)}`;
}
export function subjectEventoNoSeleccionado(evento) {
    return `Resultado de tu postulación: ${evento.titulo}`;
}
export function subjectEventoCancelado(evento) {
    return `Evento cancelado: ${evento.titulo}`;
}
