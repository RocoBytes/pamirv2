# Eventos públicos, inscripción y calendario — andinoclubpamir.app

**Especificación funcional y técnica · v0.1 (borrador para revisión antes de Claude Code)**
Fecha: 2026-08-22 · Autor: Futura SpA · Referencia externa: dav.cl (Club Alemán Andino)

Supuestos de este documento: PostgreSQL como base de datos, una tabla de usuarios existente (aquí `usuarios`, ajusta el nombre), autenticación ya resuelta, zona horaria `America/Santiago`. El DDL es Postgres plano y se traduce 1:1 a Drizzle o SQLAlchemy.

---

## 0. Referencia: cómo lo resuelve dav.cl

DAV corre sobre WordPress (Elementor) con un tipo de contenido propio para eventos (`cmcal_events`) y una taxonomía de categorías (`cmcal-event-category`): Montañismo, Trekking, Escalada, Ski, Diaporamas y Charlas, Cursos y talleres, Sociales.

Tres piezas visibles:

1. **Listado por categoría (tarjetas).** Cada tarjeta lleva badge de categoría, una cinta de estado opcional en texto libre ("Cupos Llenos", "Salida reprogramada para el 29-30 de agosto"), título, Fecha, Hora (opcional), Coordinación, Organizador, Dificultad y Costo socios / no socios. Orden por fecha descendente (lo próximo arriba), paginado, sidebar con las categorías y link al calendario completo.
2. **Detalle del evento.** Cabecera estructurada: Fecha, Duración, Ubicación, Reunión de coordinación, Organizador, Dificultad, Condición meteorológica, Altura máxima, Costo. Debajo, cuerpo libre por secciones: descripción, Itinerario, Dificultad, Condición meteorológica, Equipo (vestimenta / campamento / grupal), Alimento, Costos (datos de transferencia), Cupos (mínimo/máximo, preferencia a socios, "podría reducirse si no hay suficiente transporte"), Inscripciones, Transporte, Requisitos, nota de cancelación por clima, escala fija de dificultad (1 Fácil … 5 Extenuante) y un bloque fijo de Recomendaciones Importantes del club.
3. **Calendario general** de actividades.

**Lo que DAV no tiene:** inscripción dentro del sitio. Inscribirse es mandar un correo al club indicando si dispones de vehículo; si hay cupo, el organizador responde con un formulario al que adjunta la Declaración de Cumplimiento de Normas Básicas.

**Conclusión de diseño:** el módulo replica el modelo de contenido de DAV (cabecera estructurada + secciones de texto) y automatiza lo que DAV hace a mano: inscripción con pregunta de vehículo, declaración jurada, selección por el organizador y correos con el resultado.

---

## 1. Alcance v1

**Dentro**

- Catálogo de categorías administrable. Seed: Trekking, Salidas Montaña N°1, Salidas Montaña N°2, Excursionismo.
- Creación, edición, publicación y cancelación de eventos, solo admin, en `/creacion-evento`.
- Listado público en tarjetas `/eventos` con filtro por categoría y por fecha; detalle `/eventos/[slug]`.
- Calendario mensual `/calendario` alimentado únicamente por eventos de este módulo.
- Inscripción de usuarios autenticados: vehículo → cupos → declaración jurada (7 ítems obligatorios). Retiro de postulación.
- Cierre por el admin: selección de hasta N participantes, finalización transaccional, correo a seleccionados y a no seleccionados.
- Registro probatorio de la aceptación de la declaración (versión + timestamp).

**Fuera (v1.1+, con trigger para activarlo)**

| Funcionalidad | Trigger para construirla |
|---|---|
| Reemplazo de un seleccionado que se baja | Primera vez que pase después de finalizar |
| Lista de espera automática | Un admin lo pida dos veces |
| Costos con estado de pago | El club decida cobrar por la app |
| Organizadores con permisos propios (no admin) | Segundo admin que no sea el de seguridad |
| Recordatorio automático al admin al vencer la fecha de corte | Un evento quede sin finalizar después de la fecha |
| `/mis-inscripciones` | Socios pregunten dónde ver su historial |
| Integrar las salidas privadas existentes al mismo modelo | Se quiera un calendario único |

---

## 2. Roles y acceso

| Acción | Visitante | Socio autenticado | Admin |
|---|---|---|---|
| Ver `/eventos`, `/eventos/[slug]`, `/calendario` | ✔ (decisión D1) | ✔ | ✔ |
| Inscribirse / retirarse | ✖ → login | ✔ | ✔ |
| `/creacion-evento` (crear, editar, publicar, cancelar) | ✖ | ✖ | ✔ |
| Ver postulantes, seleccionar, finalizar | ✖ | ✖ | ✔ |
| Ver borradores | ✖ | ✖ | ✔ |

**Modelo de permiso.** Columna `rol` en usuarios (`socio` | `admin`). El email `seguridad.acp.cl@gmail.com` es el *bootstrap*, no el permiso: una migración lo marca como admin y, como respaldo, al iniciar sesión se promueve cualquier email presente en `ADMIN_BOOTSTRAP_EMAILS`. El código de autorización solo mira `rol`. Agregar admins después es un `UPDATE`.

**Regla dura:** toda mutación y todo loader de ruta admin valida en servidor (401 sin sesión, 403 sin rol). Ocultar el link del menú no es control de acceso.

---

## 3. Modelo de datos (PostgreSQL)

```sql
-- 3.1 Rol admin sobre la tabla de usuarios existente
ALTER TABLE usuarios
  ADD COLUMN rol text NOT NULL DEFAULT 'socio' CHECK (rol IN ('socio', 'admin'));
UPDATE usuarios SET rol = 'admin' WHERE lower(email) = 'seguridad.acp.cl@gmail.com';

-- 3.2 Categorías (tabla, no enum: el club agregará más)
CREATE TABLE categorias_evento (
  id      smallserial PRIMARY KEY,
  slug    text      NOT NULL UNIQUE,
  nombre  text      NOT NULL,
  color   text      NOT NULL DEFAULT '#2F6BD6',  -- badge y calendario
  orden   smallint  NOT NULL DEFAULT 0,
  activa  boolean   NOT NULL DEFAULT true
);
INSERT INTO categorias_evento (slug, nombre, orden) VALUES
  ('trekking',           'Trekking',            1),
  ('salidas-montana-n1', 'Salidas Montaña N°1', 2),
  ('salidas-montana-n2', 'Salidas Montaña N°2', 3),
  ('excursionismo',      'Excursionismo',       4);

-- 3.3 Versiones de la declaración jurada (texto versionado, nunca editado in-place)
CREATE TABLE declaracion_jurada_versiones (
  id             serial      PRIMARY KEY,
  version        text        NOT NULL UNIQUE,   -- '2026-08'
  titulo         text        NOT NULL,
  items          jsonb       NOT NULL,          -- array ordenado de strings
  hash_sha256    text        NOT NULL,          -- sha256(titulo + items canonizados)
  vigente_desde  timestamptz NOT NULL DEFAULT now(),
  vigente_hasta  timestamptz                    -- null = vigente
);

-- 3.4 Eventos
CREATE TYPE estado_evento AS ENUM ('borrador', 'publicado', 'finalizado', 'cancelado');

CREATE TABLE eventos (
  id                     uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                   text          NOT NULL UNIQUE,
  titulo                 text          NOT NULL,
  categoria_id           smallint      NOT NULL REFERENCES categorias_evento(id),
  estado                 estado_evento NOT NULL DEFAULT 'borrador',

  -- Cabecera (ficha)
  fecha_inicio           date          NOT NULL,
  hora_inicio            time,                          -- opcional, DAV lo muestra a veces
  fecha_fin              date          NOT NULL,        -- = fecha_inicio si es de un día
  duracion_texto         text          NOT NULL,        -- '2 días', '8 horas aprox.'
  ubicacion              text          NOT NULL,
  reunion_coordinacion   text          NOT NULL,        -- 'Jueves 27, 20:00, online'
  organizador_nombre     text          NOT NULL,
  organizador_usuario_id uuid          REFERENCES usuarios(id),   -- opcional (D3)
  altura_maxima_msnm     integer       CHECK (altura_maxima_msnm IS NULL OR altura_maxima_msnm BETWEEN 0 AND 9000),

  -- Cupos e inscripción
  cupos                  smallint      NOT NULL CHECK (cupos >= 1),
  fecha_corte            timestamptz   NOT NULL,        -- cierre de inscripciones

  -- Contenido (markdown simple)
  objetivo               text          NOT NULL,
  itinerario             text          NOT NULL,
  incluye                text,
  no_incluye             text,
  recomendaciones        text,
  aviso_destacado        text,                          -- cinta tipo DAV: 'Reprogramada', 'Cupos llenos'

  -- Auditoría
  creado_por             uuid          NOT NULL REFERENCES usuarios(id),
  creado_at              timestamptz   NOT NULL DEFAULT now(),
  actualizado_at         timestamptz   NOT NULL DEFAULT now(),
  publicado_at           timestamptz,
  finalizado_at          timestamptz,
  finalizado_por         uuid          REFERENCES usuarios(id),
  cancelado_at           timestamptz,
  motivo_cancelacion     text,

  CHECK (fecha_fin >= fecha_inicio),
  CHECK ((fecha_corte AT TIME ZONE 'America/Santiago')::date <= fecha_inicio)
);
CREATE INDEX eventos_listado_idx   ON eventos (estado, fecha_inicio);
CREATE INDEX eventos_categoria_idx ON eventos (categoria_id);

-- 3.5 Inscripciones
CREATE TYPE estado_inscripcion AS ENUM ('postulado', 'retirado', 'seleccionado', 'no_seleccionado');

CREATE TABLE inscripciones (
  id                      uuid               PRIMARY KEY DEFAULT gen_random_uuid(),
  evento_id               uuid               NOT NULL REFERENCES eventos(id) ON DELETE RESTRICT,
  usuario_id              uuid               NOT NULL REFERENCES usuarios(id),
  estado                  estado_inscripcion NOT NULL DEFAULT 'postulado',

  tiene_vehiculo          boolean            NOT NULL,
  cupos_vehiculo          smallint           CHECK (cupos_vehiculo BETWEEN 0 AND 30),

  declaracion_version_id  integer            NOT NULL REFERENCES declaracion_jurada_versiones(id),
  declaracion_aceptada_at timestamptz        NOT NULL,
  declaracion_ip          inet,                        -- opcional, evidencia
  declaracion_user_agent  text,                        -- opcional, evidencia

  postulado_at            timestamptz        NOT NULL DEFAULT now(),
  retirado_at             timestamptz,
  resuelto_at             timestamptz,                 -- pasó a seleccionado / no_seleccionado

  UNIQUE (evento_id, usuario_id),
  CHECK (
    (tiene_vehiculo = true  AND cupos_vehiculo IS NOT NULL) OR
    (tiene_vehiculo = false AND cupos_vehiculo IS NULL)
  )
);
CREATE INDEX inscripciones_evento_estado_idx ON inscripciones (evento_id, estado);

-- 3.6 Notificaciones (cola mínima en Postgres, idempotente)
CREATE TYPE tipo_notificacion   AS ENUM ('inscripcion_confirmada', 'seleccionado', 'no_seleccionado', 'evento_cancelado');
CREATE TYPE estado_notificacion AS ENUM ('pendiente', 'enviada', 'error');

CREATE TABLE notificaciones (
  id              uuid                PRIMARY KEY DEFAULT gen_random_uuid(),
  inscripcion_id  uuid                NOT NULL REFERENCES inscripciones(id) ON DELETE CASCADE,
  tipo            tipo_notificacion   NOT NULL,
  estado          estado_notificacion NOT NULL DEFAULT 'pendiente',
  intentos        smallint            NOT NULL DEFAULT 0,
  ultimo_error    text,
  proveedor_id    text,                               -- id del mensaje en el proveedor
  creada_at       timestamptz         NOT NULL DEFAULT now(),
  enviada_at      timestamptz,
  UNIQUE (inscripcion_id, tipo)                       -- un correo por tipo por inscripción
);
CREATE INDEX notificaciones_pendientes_idx ON notificaciones (estado)
  WHERE estado IN ('pendiente', 'error');
```

**Seed de la declaración jurada (versión `2026-08`)**

```json
{
  "version": "2026-08",
  "titulo": "DECLARACIÓN JURADA DEL PARTICIPANTE — Declaro bajo mi responsabilidad que:",
  "items": [
    "Me encuentro en condiciones físicas aptas para la actividad descrita. No tengo lesiones activas, enfermedades agudas ni condiciones de salud que comprometan mi seguridad o la del grupo.",
    "He informado al líder de la actividad sobre mis condiciones de salud, medicamentos y alergias relevantes, a través de mi ficha de socio.",
    "Cuento con el equipamiento mínimo exigido en la ficha técnica de esta actividad y sé utilizarlo correctamente.",
    "Tengo la experiencia señalada en el protocolo correspondiente al nivel de esta actividad, y la he declarado con veracidad en mi ficha de experiencia.",
    "Acepto y me comprometo a respetar las instrucciones del líder de la actividad en terreno, incluyendo la decisión de descenso preventivo si las condiciones lo ameritan.",
    "Entiendo que el incumplimiento de cualquiera de los requisitos de este protocolo puede resultar en mi exclusión de la actividad, sin derecho a reembolso de costos ya incurridos.",
    "Conozco los números de emergencia relevantes para la zona de la actividad y sé a quién llamar en caso de una emergencia."
  ]
}
```

**Campos sugeridos pero no pedidos (decisión D2)** — se agregan con `ALTER TABLE` si los apruebas:

```sql
ALTER TABLE eventos ADD COLUMN dificultad  smallint CHECK (dificultad BETWEEN 1 AND 5);  -- escala DAV
ALTER TABLE eventos ADD COLUMN costo_texto text;                                          -- 'Socios al día sin costo. No socios $15.000'
ALTER TABLE eventos ADD COLUMN imagen_url  text;                                          -- portada de la tarjeta
```

**Notas de diseño**

- `fecha_inicio` / `fecha_fin` (date) alimentan el calendario; `duracion_texto` es solo para mostrar. Nunca se parsea "2 días".
- `cupos` **no** limita las postulaciones. Es el tamaño del grupo que el admin selecciona del pool.
- No existe estado "inscripciones cerradas": se deriva de `now() >= fecha_corte`. Cero cron.
- `declaracion_version_id` + hash: si el texto cambia el año que viene, puedes demostrar qué versión aceptó cada persona. El texto vive una sola vez, no se copia por fila.
- `notificaciones` con `UNIQUE (inscripcion_id, tipo)`: finalizar dos veces, reintentar o reenviar jamás duplica un correo.
- `ON DELETE RESTRICT` en inscripciones: un evento con postulantes no se borra, se cancela. Un borrador sin inscripciones sí puede borrarse.
- `aviso_destacado` reproduce la cinta de DAV sin mezclarla con el estado de la máquina.

---

## 4. Ciclo de vida del evento

```
borrador ──publicar──▶ publicado ──finalizar──▶ finalizado
   │                      │                        │
   └────────cancelar──────┴────────────────────────┴──▶ cancelado
```

| Transición | Quién | Guardas | Efectos |
|---|---|---|---|
| borrador → publicado | admin | campos obligatorios completos (§9 E1); `fecha_corte > now()` | `publicado_at` |
| publicado → borrador | admin | cero inscripciones activas | despublica (sin correos) |
| publicado → finalizado | admin | ver §6 | inscripciones resueltas, `finalizado_at/por`, notificaciones encoladas |
| borrador / publicado → cancelado | admin | motivo opcional | `cancelado_at`; notificación `evento_cancelado` a postulados |
| finalizado → cancelado | admin | motivo obligatorio | notificación `evento_cancelado` a seleccionados |

**Edición.** En `borrador`, libre. En `publicado`, todo editable; si cambias `fecha_inicio`, `fecha_corte` o `cupos` con postulantes existentes, la UI advierte (sin correo automático en v1: usa `aviso_destacado`). En `finalizado`, solo `aviso_destacado` y cancelar.

**Estado visible (derivado, para badges y CTA)**

| Condición | Badge | CTA para el socio |
|---|---|---|
| `borrador` | "Borrador" (solo admin) | — |
| `publicado` y `now < fecha_corte` | "Inscripciones abiertas · cierra {fecha_corte}" | Inscribirme / Retirar postulación |
| `publicado` y `now ≥ fecha_corte` | "Inscripciones cerradas · en selección" | muestra "Postulado/a" |
| `finalizado` y `hoy ≤ fecha_fin` | "Participantes confirmados" | muestra mi resultado |
| `finalizado` y `hoy > fecha_fin` | "Realizado" | — |
| `cancelado` | "Cancelado" | — |

---

## 5. Flujo de inscripción (socio)

**Precondiciones en servidor:** sesión válida; `eventos.estado = 'publicado'`; `now() < fecha_corte`; no existe inscripción del usuario en `postulado` ni `seleccionado` para ese evento. Si existe una en `retirado`, se reactiva con `UPDATE` y nueva aceptación de la declaración.

**UI:** botón **Inscribirme** en la tarjeta y en el detalle → modal de 3 pasos:

1. **¿Cuento con vehículo propio?** `SÍ` / `NO`.
2. Solo si SÍ: **¿Cuántos cupos puedo entregar para otros participantes?** stepper numérico 0–30, default 0.
3. **Declaración jurada del participante.** Título, "Declaro bajo mi responsabilidad que:", los 7 ítems de la versión vigente, cada uno con su checkbox. Sin "marcar todos": la aceptación ítem por ítem es parte del valor probatorio. Botón **Confirmar inscripción** deshabilitado hasta 7/7.

**Envío:** `inscribirse(eventoId, { tiene_vehiculo, cupos_vehiculo, declaracion_version_id, items_aceptados })`. El servidor revalida todo (la versión es la vigente, los 7 vienen en `true`, rangos) y no confía en el cliente. `INSERT` (o `UPDATE` si estaba retirado). Opcional: encola `inscripcion_confirmada` (D9).

**Después:** la tarjeta y el detalle muestran "Estás postulado/a · resultado después del {fecha_corte}" y **Retirar postulación**.

**Retiro:** `retirarse(eventoId)` → guardas: inscripción en `postulado` y evento en `publicado` → `estado = 'retirado'`, `retirado_at`. Se permite también después de la fecha de corte mientras el admin no haya finalizado: es información útil para la selección, y la transacción de cierre detecta la carrera (§6, paso 2). Después de `finalizado` no hay retiro por la app en v1: el seleccionado avisa al organizador (reemplazos = v1.1).

---

## 6. Flujo de selección y cierre (admin)

**Vista `/creacion-evento/[id]` · pestaña Postulantes.** Tabla ordenada por `postulado_at` ascendente (orden de llegada: criterio neutro y auditable, D10): nombre, email, teléfono si existe, vehículo ✔/✖, cupos que ofrece, fecha de postulación, estado, checkbox de selección. Panel resumen: **Seleccionados 3 / 5 cupos** y un indicador de transporte derivado:

> conductores seleccionados: 1 · asientos ofrecidos: 4 · pasajeros seleccionados sin vehículo: 2 → **transporte cubierto**

Botón **Finalizar evento** habilitado con `1 ≤ seleccionados ≤ cupos`. Diálogo de confirmación: "Se confirmarán N participantes y se notificará a M no seleccionados. Esto cierra las inscripciones y no se puede deshacer." Si `now < fecha_corte`, advertencia adicional: "Aún no se cumple la fecha de corte; las inscripciones se cerrarán ahora."

**Transacción de cierre (pseudocódigo SQL):**

```sql
BEGIN;

-- 1. Bloquear el evento y validar estado
SELECT cupos FROM eventos WHERE id = $evento AND estado = 'publicado' FOR UPDATE;
--   0 filas → 409 "El evento ya fue finalizado o cancelado"

-- 2. Validar la selección contra el estado real
SELECT count(*) FROM inscripciones
 WHERE id = ANY($seleccionados) AND evento_id = $evento AND estado = 'postulado';
--   count ≠ len($seleccionados) → 409 "Alguien de tu selección se retiró; recarga la lista"
--   len($seleccionados) = 0 o > cupos → 422

-- 3. Resolver
UPDATE inscripciones SET estado = 'seleccionado',    resuelto_at = now()
 WHERE id = ANY($seleccionados);
UPDATE inscripciones SET estado = 'no_seleccionado', resuelto_at = now()
 WHERE evento_id = $evento AND estado = 'postulado';

-- 4. Cerrar el evento
UPDATE eventos SET estado = 'finalizado', finalizado_at = now(), finalizado_por = $admin
 WHERE id = $evento;

-- 5. Encolar correos (idempotente por el UNIQUE)
INSERT INTO notificaciones (inscripcion_id, tipo)
SELECT id,
       CASE estado WHEN 'seleccionado' THEN 'seleccionado'::tipo_notificacion
                   ELSE 'no_seleccionado'::tipo_notificacion END
  FROM inscripciones
 WHERE evento_id = $evento AND estado IN ('seleccionado', 'no_seleccionado')
ON CONFLICT (inscripcion_id, tipo) DO NOTHING;

COMMIT;

-- 6. Fuera de la transacción: despachar pendientes
```

**Despacho de correos.** `enviarNotificacionesPendientes(eventoId)`: por cada fila en `pendiente`/`error` con `intentos < 5`, envía por el proveedor; éxito → `enviada` + `proveedor_id` + `enviada_at`; fallo → `intentos + 1` + `ultimo_error`. Se dispara justo después del commit (`after()` en Next.js / `BackgroundTasks` en FastAPI) y desde el botón **Reenviar pendientes** de la pestaña. La tabla muestra por fila el estado de entrega (✔ enviado · ⚠ error · ⏳ pendiente). Un cron cada 5 minutos queda para v1.1 si los reenvíos manuales molestan.

**Por qué así y no "enviar correos dentro del request":** si el proveedor falla en el correo 7 de 10, el estado en base de datos ya es consistente y los 3 restantes se reintentan sin duplicar los 6 enviados.

---

## 7. Rutas y pantallas

**Públicas / socio**

- `GET /eventos` — tarjetas. Query: `categoria` (slug, múltiple), `mes=YYYY-MM` o `desde`/`hasta`, `incluir_pasados`. Default: `estado IN ('publicado','finalizado') AND fecha_fin >= hoy`, orden `fecha_inicio ASC`. Cancelados ocultos salvo toggle. El admin ve además sus borradores y un botón **Gestionar** en cada tarjeta (así no hace falta una lista admin aparte).
- `GET /eventos/[slug]` — detalle.
- `GET /calendario` — `?mes=YYYY-MM&categoria=`. Grilla mensual; cada evento es un chip con el color de su categoría que abarca `fecha_inicio..fecha_fin`; click → detalle; leyenda de categorías; navegación mes anterior/siguiente. Fuente: **solo** `eventos` con `estado IN ('publicado','finalizado')`. Las salidas privadas no aparecen porque no viven en esta tabla (D6). Para 5–20 eventos al mes basta una grilla propia con `date-fns`; FullCalendar solo si después quieres vista semanal o drag-and-drop.

**Admin**

- `GET /creacion-evento` — formulario de evento nuevo. Acciones: **Guardar borrador** (solo exige título) · **Publicar** (exige §9 E1). `fecha_corte` con default sugerido `fecha_inicio − 2 días, 23:59`.
- `GET /creacion-evento/[id]` — pestañas **Ficha** (editar, publicar, despublicar, cancelar) y **Postulantes** (§6).

**Tarjeta (campos en orden):** badge de categoría (color) · cinta `aviso_destacado` si existe · badge de estado derivado · título · fecha (+ `duracion_texto`; si `fecha_fin ≠ fecha_inicio`, rango) · ubicación · altura máxima · organizador · "N cupos · M postulantes" · cierre de inscripciones · CTA.

**Detalle:** cabecera tipo DAV como lista etiqueta/valor (Fecha, Duración, Ubicación, Reunión de coordinación, Organizador, Altura máxima, Cupos, Cierre de inscripciones), luego secciones **Objetivo · Itinerario · Cupos** (cantidad y la nota "el organizador selecciona entre los postulantes al cierre") **· Incluye · No incluye · Recomendaciones importantes**, y al final el bloque de inscripción (CTA o estado propio).

**Mutaciones (server actions o endpoints, nombres orientativos):** `crearEvento`, `actualizarEvento`, `publicarEvento`, `despublicarEvento`, `cancelarEvento`, `inscribirse`, `retirarse`, `listarPostulantes`, `finalizarEvento`, `reenviarNotificaciones`.

---

## 8. Correos

**Remitente:** `Club Andino Pamir <eventos@andinoclubpamir.app>` · Reply-To: `seguridad.acp.cl@gmail.com`. Configurar SPF, DKIM y DMARC del dominio en el proveedor. No enviar por SMTP de Gmail: límites diarios, reputación y el "enviado en nombre de" en la bandeja del socio.

**Proveedor:** Resend, Brevo o Amazon SES (D5). Cualquiera de los tres cubre 10–50 correos por evento sin costo relevante.

**Plantillas** (variables `{{nombre}}`, `{{titulo}}`, `{{fecha}}`, `{{ubicacion}}`, `{{reunion_coordinacion}}`, `{{organizador}}`, `{{cupos}}`, `{{postulantes}}`, `{{url_evento}}`). Texto plano + HTML sencillo, tono cercano.

| Tipo | Asunto | Contenido |
|---|---|---|
| `seleccionado` | Quedaste seleccionado/a: {{titulo}} · {{fecha}} | Confirmación; fecha, ubicación, reunión de coordinación (obligatoria), organizador; recordatorio de equipo mínimo y de revisar su ficha; link al evento; "si no puedes asistir, avisa al organizador a la brevedad". |
| `no_seleccionado` | Resultado de tu postulación: {{titulo}} | Esta vez no quedaste dentro del cupo ({{cupos}} cupos, {{postulantes}} postulantes); agradecimiento; link al calendario de próximos eventos. |
| `inscripcion_confirmada` (D9) | Recibimos tu postulación: {{titulo}} | Resumen (vehículo, cupos ofrecidos), fecha de corte, link para retirarse. |
| `evento_cancelado` | Evento cancelado: {{titulo}} | Motivo si existe; link al calendario. |

---

## 9. Reglas de validación en servidor (lista directa para tests)

**Evento**

- E1 · Para publicar son obligatorios: `titulo`, `categoria_id`, `fecha_inicio`, `fecha_fin`, `duracion_texto`, `ubicacion`, `reunion_coordinacion`, `organizador_nombre`, `cupos`, `fecha_corte`, `objetivo`, `itinerario`. Un borrador solo exige `titulo`.
- E2 · `fecha_fin >= fecha_inicio`.
- E3 · `fecha_corte` en `America/Santiago` cae en o antes de `fecha_inicio`; al publicar además `fecha_corte > now()`.
- E4 · `cupos >= 1`.
- E5 · `slug` único: `slugify(titulo)` y, solo si colisiona, sufijo corto.
- E6 · Toda mutación: 401 sin sesión, 403 sin `rol = 'admin'`.

**Inscripción**

- I1 · Solo autenticado (401).
- I2 · Evento `publicado` y `now() < fecha_corte`; si no, 409 con mensaje claro.
- I3 · `tiene_vehiculo` booleano; `cupos_vehiculo` entero 0–30 si `true`, `null` si `false` (422).
- I4 · Declaración: `declaracion_version_id` es la vigente y los 7 ítems vienen aceptados; el servidor rechaza cualquier otra cosa (422).
- I5 · Una inscripción por usuario y evento: el `UNIQUE` es la última línea de defensa; error 23505 → "Ya estás inscrito/a".
- I6 · Retiro solo desde `postulado` y con evento `publicado` (409 en otro caso).

**Finalización**

- F1 · Evento `publicado`, tomado con `FOR UPDATE` (409 si no).
- F2 · `1 ≤ |seleccionados| ≤ cupos` (422).
- F3 · Todos los seleccionados pertenecen al evento y están en `postulado` (409 si alguno se retiró).
- F4 · Idempotente: segunda llamada → 409; cero correos duplicados (garantizado por `UNIQUE` en `notificaciones`).
- F5 · Los no seleccionados son exactamente los `postulado` restantes; los `retirado` no se tocan ni reciben correo.

**Matriz de autorización** 401 / 403 / 404 / 409 / 422 por mutación, en el mismo formato que usaste en Futura Docs.

---

## 10. Datos personales y registro probatorio (Ley 21.719)

- La declaración **no captura** datos de salud: son afirmaciones. Se guarda solo `declaracion_version_id`, `declaracion_aceptada_at` y, opcionalmente, IP y user-agent como evidencia. El texto no se copia por inscripción.
- Salud, medicamentos y alergias viven en la ficha de socio ya existente. Se enlaza, no se duplica: datos de salud son sensibles bajo la 21.719 y el principio de minimización aplica.
- El admin ve nombre, email y datos de vehículo de los postulantes con finalidad legítima (organizar la salida). Los demás socios ven solo el conteo, nunca la lista.
- Correos con el mínimo necesario; sin adjuntos con datos de terceros.
- Retención de inscripciones y aceptaciones: decisión D7. Conviene fijar un plazo explícito (por ejemplo, mientras el socio esté activo más un período de respaldo ante incidentes) y validarlo con asesoría; esto no es consejo legal.

---

## 11. Plan de implementación (agentes secuenciales, revisión humana entre cada uno)

| Agente | Entrega | Criterio de aceptación |
|---|---|---|
| A0 | Migraciones §3, seeds (categorías, declaración `2026-08`, rol admin), tipos compartidos | Migración aplica y revierte limpia; seed idempotente |
| A1 | `/creacion-evento` y `/creacion-evento/[id]` · Ficha: crear, editar, publicar, despublicar, cancelar | Reglas E1–E6 con tests; matriz 401/403 |
| A2 | `/eventos` (tarjetas + filtros) y `/eventos/[slug]` | Estados visibles §4 correctos en todos los casos; borradores solo para admin |
| A3 | Inscripción: modal 3 pasos, retiro, reglas I1–I6 | Test de doble envío concurrente → una sola fila; versión de declaración verificada |
| A4 | Pestaña Postulantes, transacción F1–F5, `notificaciones`, proveedor de correo, reenvío | Finalizar dos veces → 409 y cero correos duplicados; fallo simulado del proveedor → reintento sin duplicar |
| A5 | `/calendario` | Eventos multi-día abarcan sus fechas; filtro por categoría; solo `publicado`/`finalizado` |
| A6 | Revisión de seguridad + QA manual end-to-end | Crear → publicar → 10 postulaciones → finalizar con 5 → 10 correos con el estado correcto |

A5 es independiente y puede adelantarse. Cada agente presenta plan antes de codificar; merge `--no-ff` con rama preservada.

---

## 12. Decisiones abiertas

| # | Decisión | Recomendación | Trigger para revertir |
|---|---|---|---|
| D1 | ¿Listado, detalle y calendario visibles sin login? | Sí, públicos (como DAV, sirve para compartir links); inscribirse exige login | El club no quiera exponer ubicaciones u organizadores a no socios |
| D2 | Campos extra de DAV: dificultad 1–5, costo socios/no socios, imagen de portada, condición meteorológica | Agregar `dificultad`, `costo_texto` e `imagen_url`; meteorología va en Recomendaciones | — |
| D3 | Organizador: texto libre vs usuario de la app | Texto + FK opcional (ya en DDL) para que en v1.1 el organizador gestione sus propios eventos | — |
| D4 | Reemplazos después de finalizar | v1.1 | Primer seleccionado que se baje |
| D5 | Proveedor de correo y dominio remitente | Resend o SES con `eventos@andinoclubpamir.app` | Rebotes o spam sostenidos |
| D6 | Salidas privadas existentes: ¿misma tabla con `visibilidad` o tabla aparte? | Tabla aparte; el calendario lee solo `eventos` | Se pida un calendario único con ambas |
| D7 | Retención de inscripciones y aceptaciones | Plazo explícito, validado con asesoría | — |
| D8 | Mostrar "socio al día" en la tabla de postulantes (DAV prioriza socios al día) | Sí, si el dato ya existe en la ficha | — |
| D9 | Correo de confirmación al postular | Sí: barato y evita dudas de "¿quedó registrada?" | Quejas por volumen |
| D10 | Orden de la tabla de postulantes | Por llegada | El club defina otro criterio (antigüedad, nivel) |
