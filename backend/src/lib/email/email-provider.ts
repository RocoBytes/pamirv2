// Puerto de envío de correo: cada adaptador (Resend, consola) implementa esta
// interfaz sin filtrar detalles propios (HTTP, SDK, etc.) al resto del código.
export interface EmailMessage {
  from: string;
  replyTo?: string;
  to: string;
  subject: string;
  html: string;
  // Evita reintentos accidentales (p. ej. un cron que corre dos veces) desde
  // duplicar el envío. Cada adaptador decide cómo usarla; los que no soportan
  // idempotencia simplemente la ignoran.
  idempotencyKey?: string;
}

export interface EmailProvider {
  send(message: EmailMessage): Promise<{ id: string | undefined }>;
}
