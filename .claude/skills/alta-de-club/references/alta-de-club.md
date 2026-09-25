# Alta de un club — detalle

## Derivación desde el nombre completo

| Campo | Regla | "Andino Club Pamir" | "Club Andino Testing" |
|---|---|---|---|
| `--name` | El nombre completo, tal cual. Es lo que muestran los correos y el display name del `From:`. | `Andino Club Pamir` | `Club Andino Testing` |
| `--slug` | El nombre de pila, en minúsculas. | `pamir` | `testing` |
| `--short-name` | Siempre el nombre de pila. Solo afecta la interfaz; los correos usan `--name`. | `Pamir` | `Testing` |
| `--membresia` | Nombre completo sin la palabra "Club", en mayúsculas, sin tildes, prefijo `SOCIO_`. | `SOCIO_ANDINO_PAMIR` | `SOCIO_ANDINO_TESTING` |

Slugs reservados (`backend/src/scripts/tenant-args.ts`): `platform`, `plataforma`,
`admin`, `api`, `www`, `app`, `riala`, y todo lo que empiece con `iso-test-`
(lo purga `npm run test:isolation`).

## Qué hace cada campo de contacto

| Campo | Qué es realmente |
|---|---|
| `contactName` / `contactEmail` | "A quién le escribe el socio". Sale en el pie de cada correo Y es el `Reply-To` (`lib/email/club-email.ts`). |
| `alertEmail` | "A quién le grita el sistema". DESTINATARIO de la alarma "salida sin cierre" (`lib/alert-recipient.ts`, consumido por `cron.controller.ts`). No aparece en ningún HTML. Si está mal, la alarma cae en un buzón que nadie mira. |
| `adminEmail` | Recibe la invitación del primer `ADMIN`. Un solo uso, expira en 7 días. |

En un club real `contactEmail` y `alertEmail` no deberían ser el mismo buzón.
El remitente nunca depende del club: lo fija `MAIL_FROM[kind]` en `lib/config.ts`.

## Los 4 archivos del código de membresía

`Organization.membresiaPropia` decide quién ve la biblioteca de documentos del
club (`lib/documentos-access.ts`). No hay migración de Prisma: es un `String`,
pero `tenants.service.ts` valida a mano que sea único entre clubes.

1. `backend/src/lib/membresias.ts` — `MEMBRESIA_CLUBS` y `MEMBRESIAS_PROPIAS`.
   Única fuente del backend: la usan `tenant-args.ts` y `tenants.service.ts`.
2. `backend/src/lib/membresias.test.ts` — alambre de tropiezo que fija el
   conjunto exacto. Falla a propósito; actualízalo.
3. `frontend/src/types/salida.ts` — la unión `MembresiaClub`,
   `CLUB_BADGE_LABELS` (sigla corta) y `CLUB_FILTER_LABELS` (etiqueta legible).
   Los dos últimos son `Record<MembresiaClub, string>`: `tsc` obliga.
4. `frontend/src/components/wizard/Step3Equipment.tsx` — el `z.enum([...])`.

En producción esto es un release: hay que desplegar antes de poder crear el club.

## Comando

```bash
cd backend
npm run tenant:create -- \
  --slug <slug> \
  --name "<nombre completo>" \
  --short-name "<nombre de pila>" \
  --membresia SOCIO_<CODIGO> \
  --alert-email <email> \
  --contact-name "<nombre>" \
  --contact-email <email> \
  --admin-email <email>
```

Crea en una transacción la organización, sus 6 categorías de evento y la
declaración jurada vigente; recién después emite la invitación. Si el correo
falla, **el club queda creado igual** y el comando imprime el
`npm run tenant:invite` para reintentar solo la invitación.

Si el correo de `--admin-email` ya tiene una cuenta RIALA (de otro club), la
invitación de plataforma igual se emite: la persona la acepta iniciando
sesión con su contraseña de siempre en vez de crear una cuenta nueva, y se le
agrega la membresía `ADMIN` de este club sin tocar su perfil compartido — ver
`docs/superpowers/specs/2026-09-23-multi-club-membership-design.md` y el plan
`docs/superpowers/plans/2026-09-24-multi-club-03-joining.md` (Ruling 7).

`FRONTEND_URL` decide el dominio del enlace: si es `localhost`, el CLI lo
advierte y ese link solo sirve en la máquina local.

## Corregir después

`npm run tenant:update -- --slug <slug> [--name] [--short-name] [--contact-name] [--contact-email] [--alert-email]`

Actualización parcial: solo las claves que cambian llegan a Prisma, y si nada
cambia no escribe. `--slug`, la membresía y el estado no son editables ahí
(el estado tiene `tenant:suspend` / `tenant:activate`).
