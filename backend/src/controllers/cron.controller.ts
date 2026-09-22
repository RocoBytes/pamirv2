import { Request, Response } from 'express';
import { prisma } from '../lib/prisma.js';
import { sendClubEmail } from '../lib/email/club-email.js';
import { buildAlertaSalidaEmail, buildRecordatorioCierreEmail, brandingFor } from '../lib/email-templates.js';
import { subjectAlertaSalida, subjectRecordatorioCierre } from '../lib/email/subjects.js';
import { resolveAlertRecipient } from '../lib/alert-recipient.js';
import { instanteSantiago } from '../lib/santiago-time.js';
import { runAsPlatform, runWithOrganization } from '../lib/tenant-context.js';
import type { OrganizationSummary } from '../types/index.js';

/**
 * GET /api/cron/check-alertas?secret=<CRON_SECRET>
 *
 * Two time-based actions, resolved in the same loop:
 *  1. ~1h before the threshold, a courtesy reminder is sent to the trip
 *     owner/creator (recordatorioCierreEnviadoAt) asking them to register the
 *     cierre before the alarm escalates.
 *  2. At/after the threshold, the "salida sin cierre" alarm is sent to the
 *     admin (alertaEnviadaAt).
 * Cada acción intenta el envío ANTES de marcar su columna: un correo perdido
 * es inaceptable (es una alarma de seguridad), un duplicado es tolerable. Si
 * el envío falla, la columna queda sin marcar y la corrida siguiente reintenta;
 * el proveedor recibe idempotencyKey para que un reintento nunca duplique el
 * correo que sí llegó a salir.
 */
const REMINDER_LEAD_MS = 60 * 60 * 1000; // 1h before the alarm
export async function checkAlertas(req: Request, res: Response): Promise<void> {
  // An unset CRON_SECRET intentionally denies all requests (fail closed).
  const secret = process.env.CRON_SECRET;
  if (!secret || req.query.secret !== secret) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    // Esta ruta no pasa por authMiddleware (la protege CRON_SECRET, no una
    // sesión), así que nunca hay un contexto de tenant ambiente: el barrido
    // que abarca todos los clubes corre en contexto de plataforma.
    const candidates = await runAsPlatform(() =>
      // Candidate salidas: open (EN_CURSO), no cierre, not a historical record,
      // and still pending at least one of the two actions (reminder or alarm).
      // Se incluye el resumen completo del club dueño para poder enviar el
      // correo "como" ese club (remitente, reply-to) y resolver el
      // destinatario de la alarma sin volver a consultar Organization.
      prisma.salida.findMany({
        where: {
          status: 'EN_CURSO',
          cierres: { none: {} },
          // Los registros históricos del admin nunca disparan alarma.
          esRegistroHistorico: false,
          OR: [
            { alertaEnviadaAt: null },
            { recordatorioCierreEnviadoAt: null },
          ],
        },
        include: {
          organization: {
            select: {
              id: true,
              slug: true,
              name: true,
              shortName: true,
              membresiaPropia: true,
              alertEmail: true,
              contactName: true,
              contactEmail: true,
            },
          },
        },
      }),
    );

    const now = new Date();
    let alerted = 0;
    let reminded = 0;
    let fallidas = 0;
    // Una sola advertencia por corrida, aunque el override esté "ignorado" en
    // varias salidas: un DEV_ALERT_EMAIL_OVERRIDE olvidado en producción es un
    // error de configuración del entorno, no de una salida en particular.
    let overrideIgnoredWarned = false;

    for (const salida of candidates) {
      const organization: OrganizationSummary = salida.organization;
      const branding = brandingFor(organization);

      try {
        // Cada salida se procesa dentro del contexto de SU club: los updates
        // de este bloque (recordatorioCierreEnviadoAt/alertaEnviadaAt) deben
        // quedar filtrados por el mismo club que la encontró.
        await runWithOrganization(salida.organizationId, async () => {
          // The wizard sends "YYYY-MM-DD" and the controller stores it as
          // midnight UTC of the chosen calendar date, so the UTC date string
          // IS the intended return date — no timezone conversion here.
          const returnDateStr = salida.fechaRetornoEstimada.toISOString().slice(0, 10);

          // Anchor horaAlerta to the Santiago offset valid on that date (DST-safe:
          // Chile observes DST, and the offset is derived for the salida's own
          // return date — not "now" — so a return date on the other side of a DST
          // transition still resolves correctly).
          const alarmMoment = instanteSantiago(returnDateStr, salida.horaAlerta);
          const reminderMoment = new Date(alarmMoment.getTime() - REMINDER_LEAD_MS);

          // Reminder branch. Solo se intenta enviar mientras todavía hay tiempo
          // antes de la alarma y hay un destinatario (creatorEmail es opcional,
          // p.ej. salidas creadas como invitado). Si no corresponde enviar (ya
          // no hay tiempo, o no hay destinatario) igual se marca: no es un envío
          // fallido, es un recordatorio que ya no aplica.
          if (salida.recordatorioCierreEnviadoAt === null && now >= reminderMoment) {
            const puedeRecordar = now < alarmMoment && salida.creatorEmail;
            if (!puedeRecordar) {
              await prisma.salida.update({
                where: { id: salida.id },
                data: { recordatorioCierreEnviadoAt: new Date() },
              });
            } else {
              try {
                await sendClubEmail(organization, {
                  to: salida.creatorEmail as string,
                  subject: subjectRecordatorioCierre(salida.nombreActividad),
                  html: buildRecordatorioCierreEmail(salida, branding),
                  kind: 'alerta',
                  idempotencyKey: `recordatorio-cierre:${salida.id}`,
                });
                // Marcar SOLO tras el envío exitoso: si el proveedor falla, la
                // columna queda en null y la próxima corrida reintenta.
                await prisma.salida.update({
                  where: { id: salida.id },
                  data: { recordatorioCierreEnviadoAt: new Date() },
                });
                reminded++;
              } catch (emailErr) {
                fallidas++;
                console.error(
                  `[cron/check-alertas] Recordatorio de cierre falló para salida ${salida.id} ` +
                    '(recordatorioCierreEnviadoAt sigue sin marcar: se reintentará en la próxima corrida):',
                  emailErr,
                );
              }
            }
          }

          // Alarm branch — admin escalation at/after the threshold.
          if (salida.alertaEnviadaAt === null && now >= alarmMoment) {
            const { recipient, overrideIgnored } = resolveAlertRecipient({
              orgAlertEmail: organization.alertEmail,
              override: process.env.DEV_ALERT_EMAIL_OVERRIDE,
              nodeEnv: process.env.NODE_ENV,
            });
            if (overrideIgnored && !overrideIgnoredWarned) {
              overrideIgnoredWarned = true;
              console.warn(
                '[cron/check-alertas] DEV_ALERT_EMAIL_OVERRIDE está definida pero NODE_ENV=production: se ignora ' +
                  'y cada salida usa el correo de alerta de su propio club.',
              );
            }

            try {
              await sendClubEmail(organization, {
                to: recipient,
                subject: subjectAlertaSalida(salida.nombreActividad),
                html: buildAlertaSalidaEmail(salida, branding),
                kind: 'alerta',
                idempotencyKey: `alerta:${salida.id}`,
              });
              // Marcar SOLO tras el envío exitoso: un duplicado es aceptable,
              // perder una alarma de seguridad no lo es. Si el proveedor falla,
              // alertaEnviadaAt queda en null y la próxima corrida reintenta.
              await prisma.salida.update({
                where: { id: salida.id },
                data: { alertaEnviadaAt: new Date() },
              });
              alerted++;
            } catch (emailErr) {
              fallidas++;
              console.error(
                `[cron/check-alertas] Email de alerta falló para salida ${salida.id} ` +
                  '(alertaEnviadaAt sigue sin marcar: se reintentará en la próxima corrida):',
                emailErr,
              );
            }
          }
        });
      } catch (err) {
        // One failure must not block the remaining salidas
        console.error(`[cron/check-alertas] Error al procesar salida ${salida.id}:`, err);
      }
    }

    res.json({ checked: candidates.length, alerted, reminded, fallidas });
  } catch (err) {
    console.error('[cron/check-alertas]', err);
    res.status(500).json({ error: 'Error interno al procesar alertas' });
  }
}
