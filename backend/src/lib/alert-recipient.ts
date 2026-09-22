// Decide a qué correo va la alarma de seguridad del cron ("salida sin
// cierre"). Función pura (sin process.env, sin I/O) para poder probarla sin
// tocar el entorno real — el llamador (cron.controller.ts) le pasa
// process.env.NODE_ENV y process.env.DEV_ALERT_EMAIL_OVERRIDE explícitamente.
export interface ResolveAlertRecipientParams {
  // Organization.alertEmail del club dueño de la salida.
  orgAlertEmail: string;
  // DEV_ALERT_EMAIL_OVERRIDE, tal cual viene del entorno.
  override: string | undefined;
  nodeEnv: string | undefined;
}

export interface ResolveAlertRecipientResult {
  recipient: string;
  // true solo cuando había un override no vacío y se ignoró por estar en
  // producción — así el llamador puede loguear una sola advertencia por
  // corrida en vez de una por salida.
  overrideIgnored: boolean;
}

export function resolveAlertRecipient({
  orgAlertEmail,
  override,
  nodeEnv,
}: ResolveAlertRecipientParams): ResolveAlertRecipientResult {
  const trimmedOverride = override?.trim();
  const hasOverride = Boolean(trimmedOverride);
  const isProduction = nodeEnv === 'production';

  if (!isProduction && hasOverride) {
    return { recipient: trimmedOverride as string, overrideIgnored: false };
  }

  return {
    recipient: orgAlertEmail,
    overrideIgnored: isProduction && hasOverride,
  };
}
