import { Request, Response } from 'express';
import { prisma } from '../lib/prisma.js';
import { sendEmail } from '../lib/google-gmail.js';
import { buildAlertaSalidaEmail, buildRecordatorioCierreEmail } from '../lib/email-templates.js';
import { ADMIN_EMAIL } from '../lib/constants.js';
import { instanteSantiago } from '../lib/santiago-time.js';

/**
 * GET /api/cron/check-alertas?secret=<CRON_SECRET>
 *
 * Two time-based actions, resolved in the same loop:
 *  1. ~1h before the threshold, a courtesy reminder is sent to the trip
 *     owner/creator (recordatorioCierreEnviadoAt) asking them to register the
 *     cierre before the alarm escalates.
 *  2. At/after the threshold, the "salida sin cierre" alarm is sent to the
 *     admin (alertaEnviadaAt).
 * Each action stamps its own flag before sending so re-runs never duplicate.
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
    // Candidate salidas: open (EN_CURSO), no cierre, not a historical record,
    // and still pending at least one of the two actions (reminder or alarm).
    const candidates = await prisma.salida.findMany({
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
    });

    const now = new Date();
    let alerted = 0;
    let reminded = 0;

    for (const salida of candidates) {
      try {
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

        // Reminder branch — resolve once, then never reconsider. Stamp first so
        // that whether or not we email, the reminder is retired and the broadened
        // candidate query stops returning this salida for the reminder.
        if (salida.recordatorioCierreEnviadoAt === null && now >= reminderMoment) {
          await prisma.salida.update({
            where: { id: salida.id },
            data: { recordatorioCierreEnviadoAt: new Date() },
          });

          // Email only while there is still time before the alarm and we have a
          // recipient (creatorEmail is optional, e.g. guest-created salidas).
          if (now < alarmMoment && salida.creatorEmail) {
            try {
              await sendEmail(
                salida.creatorEmail,
                `Recordatorio: cierra tu salida — ${salida.nombreActividad}`,
                buildRecordatorioCierreEmail(salida),
              );
              reminded++;
            } catch (emailErr) {
              console.error(
                `[cron/check-alertas] Recordatorio de cierre falló para salida ${salida.id} (recordatorioCierreEnviadoAt ya marcado, no se reintentará):`,
                emailErr,
              );
            }
          }
        }

        // Alarm branch — admin escalation at/after the threshold.
        if (salida.alertaEnviadaAt === null && now >= alarmMoment) {
          // Mark the flag BEFORE sending: if the email send fails afterwards we
          // lose one alert (recoverable, logged below), but we never risk
          // re-sending a duplicate safety alarm on the next cron run.
          await prisma.salida.update({
            where: { id: salida.id },
            data: { alertaEnviadaAt: new Date() },
          });

          try {
            await sendEmail(
              ADMIN_EMAIL,
              `ALERTA: Salida sin cierre — ${salida.nombreActividad}`,
              buildAlertaSalidaEmail(salida),
            );
            alerted++;
          } catch (emailErr) {
            console.error(
              `[cron/check-alertas] Email de alerta falló para salida ${salida.id} (alertaEnviadaAt ya marcado, no se reintentará):`,
              emailErr,
            );
          }
        }
      } catch (err) {
        // One failure must not block the remaining salidas
        console.error(`[cron/check-alertas] Error al procesar salida ${salida.id}:`, err);
      }
    }

    res.json({ checked: candidates.length, alerted, reminded });
  } catch (err) {
    console.error('[cron/check-alertas]', err);
    res.status(500).json({ error: 'Error interno al procesar alertas' });
  }
}
