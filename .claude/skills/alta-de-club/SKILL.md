---
name: alta-de-club
description: "Trigger: crear club, nuevo tenant, dar de alta un club, tenant:create, onboarding de club. Guía por preguntas el alta de un club y ejecuta la creación."
license: Apache-2.0
metadata:
  author: "RocoBytes"
  version: "1.0"
---

## Activation Contract

Cárgalo cuando se pida crear, dar de alta u onboardear un club (tenant) nuevo, en testing o en producción.

## Hard Rules

- Pregunta SIEMPRE `--alert-email` y `--admin-email`. Nunca los inventes ni los deduzcas de otro campo.
- `alertEmail` es el DESTINATARIO de la alarma de seguridad "salida sin cierre", no un remitente ni texto del correo. Dilo al preguntarlo.
- El remitente es siempre `notificaciones@riala.cl` / `alertas@riala.cl`. Ningún campo del club lo cambia.
- Una pregunta a la vez. Después de preguntar, detente y espera.
- No corras `tenant:create` hasta que el código de membresía esté en los 4 archivos y backend y frontend pasen lint, compilación y tests.
- `membresias.test.ts` falla a propósito al agregar un código. Actualizar ese test es parte del alta, no un test roto.

## Decision Gates

| Destino | Cómo se ejecuta |
|---|---|
| Testing (local) | `npm run tenant:create -- ...` desde `backend/`. `db:guard` valida `DATABASE_URL` contra `db-target.json`. |
| Producción | El cambio de código debe estar desplegado ANTES. El comando corre dentro del contenedor del VPS con `ALLOW_ANY_DB_TARGET=1`; el npm script no acepta ese escape. |
| Corregir un club ya creado | `npm run tenant:update -- --slug <slug> [...]`. Nunca SQL a mano. |

## Execution Steps

1. Pide el nombre completo del club. Deriva `slug`, `--short-name` y el código de membresía según `references/alta-de-club.md` y muéstralos para confirmar.
2. Pregunta lo que falta, una a la vez: `--contact-name`, `--contact-email`, `--alert-email`, `--admin-email`.
3. Agrega el código de membresía en los 4 archivos y actualiza el alambre de `membresias.test.ts`.
4. Verifica: en `backend/` `npm run lint && npx tsc --noEmit && npm test`; en `frontend/` `npm run lint && npm run build && npm test`.
5. Corre `npm run tenant:list` y confirma que el slug y el código están libres.
6. Ejecuta `tenant:create` con todos los flags.
7. Verifica: `npm run tenant:list` y `curl -s localhost:3001/api/clubes/<slug>/marca`.

## Output Contract

Devuelve: slug, nombre, nombre corto y código creados; categorías y versión de declaración jurada; si el correo salió; el enlace de invitación con su expiración y una advertencia si `FRONTEND_URL` es localhost; y la salida real de los comandos de verificación.

## References

- `references/alta-de-club.md` — convenciones de derivación, los 4 archivos del código de membresía, semántica de cada campo y la tabla de flags.
