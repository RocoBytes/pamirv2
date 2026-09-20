// Destinatario de las alertas de seguridad automáticas (por ejemplo, "salida
// sin cierre" desde el cron). No tiene relación con permisos de administrador
// — la autorización de admin depende del rol en la base de datos (ver
// src/lib/authz.ts), nunca de este valor. El default preserva el
// comportamiento de v1 si ALERT_EMAIL no está definido en el entorno.
export const ALERT_EMAIL = process.env.ALERT_EMAIL?.trim() || 'seguridad.acp.cl@gmail.com';
