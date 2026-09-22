import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { selectEmailProvider, resolveEmailProvider, createProviderConnectionCache } from './get-email-provider.js';
import type { SelectEmailProviderParams, ProviderFactories } from './get-email-provider.js';
import type { EmailProvider } from './email-provider.js';

const smtpEnv = {
  smtpHost: 'smtp.riala.cl',
  smtpPort: '587',
  smtpUser: 'user',
  smtpPass: 'pass',
} satisfies Partial<SelectEmailProviderParams>;

const emptySmtpEnv = {
  smtpHost: undefined,
  smtpPort: undefined,
  smtpUser: undefined,
  smtpPass: undefined,
} satisfies Partial<SelectEmailProviderParams>;

describe('selectEmailProvider', () => {
  it('EMAIL_PROVIDER=smtp explícito con env completo devuelve smtp', () => {
    const result = selectEmailProvider({ emailProvider: 'smtp', ...smtpEnv, nodeEnv: 'production' });
    assert.equal(result, 'smtp');
  });

  it('EMAIL_PROVIDER=smtp sin SMTP_HOST lanza nombrando la variable', () => {
    assert.throws(
      () => selectEmailProvider({ emailProvider: 'smtp', ...smtpEnv, smtpHost: undefined, nodeEnv: 'development' }),
      /SMTP_HOST/,
    );
  });

  it('EMAIL_PROVIDER=smtp con puerto fuera de rango lanza nombrando SMTP_PORT', () => {
    assert.throws(
      () => selectEmailProvider({ emailProvider: 'smtp', ...smtpEnv, smtpPort: '70000', nodeEnv: 'development' }),
      /SMTP_PORT/,
    );
  });

  it('EMAIL_PROVIDER=smtp con puerto no numérico lanza nombrando SMTP_PORT', () => {
    assert.throws(
      () => selectEmailProvider({ emailProvider: 'smtp', ...smtpEnv, smtpPort: 'no-es-un-puerto', nodeEnv: 'development' }),
      /SMTP_PORT/,
    );
  });

  it('EMAIL_PROVIDER=smtp con varias variables faltantes las nombra todas y ninguna otra', () => {
    assert.throws(
      () => selectEmailProvider({ emailProvider: 'smtp', ...emptySmtpEnv, nodeEnv: 'development' }),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, /SMTP_HOST/);
        assert.match(err.message, /SMTP_PORT/);
        assert.match(err.message, /SMTP_USER/);
        assert.match(err.message, /SMTP_PASS/);
        return true;
      },
    );
  });

  it('EMAIL_PROVIDER=console fuera de producción devuelve console', () => {
    const result = selectEmailProvider({ emailProvider: 'console', ...emptySmtpEnv, nodeEnv: 'development' });
    assert.equal(result, 'console');
  });

  it('EMAIL_PROVIDER=console en producción lanza', () => {
    assert.throws(
      () => selectEmailProvider({ emailProvider: 'console', ...smtpEnv, nodeEnv: 'production' }),
      /producción/,
    );
  });

  it('sin EMAIL_PROVIDER, con SMTP_HOST, devuelve smtp', () => {
    const result = selectEmailProvider({ emailProvider: undefined, ...smtpEnv, nodeEnv: 'development' });
    assert.equal(result, 'smtp');
  });

  it('sin EMAIL_PROVIDER, sin SMTP_HOST, fuera de producción, devuelve console', () => {
    const result = selectEmailProvider({ emailProvider: undefined, ...emptySmtpEnv, nodeEnv: 'test' });
    assert.equal(result, 'console');
  });

  it('sin EMAIL_PROVIDER, sin SMTP_HOST, en producción, lanza', () => {
    assert.throws(
      () => selectEmailProvider({ emailProvider: undefined, ...emptySmtpEnv, nodeEnv: 'production' }),
      /producción/,
    );
  });

  it('un EMAIL_PROVIDER desconocido lanza', () => {
    assert.throws(
      () => selectEmailProvider({ emailProvider: 'sendgrid', ...smtpEnv, nodeEnv: 'development' }),
      /sendgrid/,
    );
  });

  it('EMAIL_PROVIDER se normaliza a minúsculas y sin espacios', () => {
    const result = selectEmailProvider({ emailProvider: '  SMTP  ', ...smtpEnv, nodeEnv: 'development' });
    assert.equal(result, 'smtp');
  });
});

// Proveedor y fábrica falsos: nunca abren una conexión real. Se devuelven los
// mocks por separado (no solo el objeto ProviderFactories) para poder leer
// `.mock.calls.length` con el mismo estilo que el resto de los tests del
// proyecto (ver smtp.provider.test.ts / club-email.test.ts).
function fakeFactories() {
  const smtp = mock.fn((): EmailProvider => ({ send: () => Promise.resolve({ id: undefined }) }));
  const consoleFactory = mock.fn((): EmailProvider => ({ send: () => Promise.resolve({ id: undefined }) }));
  const factories: ProviderFactories = { smtp, console: consoleFactory };
  return { factories, smtp, consoleFactory };
}

describe('resolveEmailProvider', () => {
  it('con proveedor "console" nunca llama a la fábrica smtp', () => {
    const cache = createProviderConnectionCache();
    const { factories, smtp } = fakeFactories();
    const provider = resolveEmailProvider({ emailProvider: 'console', ...emptySmtpEnv, nodeEnv: 'test' }, cache, factories);
    assert.ok(provider);
    assert.equal(smtp.mock.calls.length, 0);
  });

  it('dos cuentas con host+puerto+usuario idénticos reutilizan la misma instancia SMTP', () => {
    const cache = createProviderConnectionCache();
    const { factories, smtp } = fakeFactories();

    // Simula dos EmailKind ("notificacion" y "alerta") que, al no definir su
    // propio par de credenciales, ambos cayeron al mismo SMTP_USER/SMTP_PASS
    // global — deben compartir la MISMA conexión en vez de abrir un pool cada
    // uno para exactamente la misma cuenta.
    const notificacion = resolveEmailProvider({ emailProvider: 'smtp', ...smtpEnv, nodeEnv: 'production' }, cache, factories);
    const alerta = resolveEmailProvider({ emailProvider: 'smtp', ...smtpEnv, nodeEnv: 'production' }, cache, factories);

    assert.equal(notificacion, alerta);
    assert.equal(smtp.mock.calls.length, 1);
  });

  it('dos cuentas con usuarios distintos abren conexiones separadas', () => {
    const cache = createProviderConnectionCache();
    const { factories, smtp } = fakeFactories();

    const notificacion = resolveEmailProvider(
      { emailProvider: 'smtp', ...smtpEnv, smtpUser: 'notificaciones@riala.cl', nodeEnv: 'production' },
      cache,
      factories,
    );
    const alerta = resolveEmailProvider(
      { emailProvider: 'smtp', ...smtpEnv, smtpUser: 'alertas@riala.cl', nodeEnv: 'production' },
      cache,
      factories,
    );

    assert.notEqual(notificacion, alerta);
    assert.equal(smtp.mock.calls.length, 2);
  });

  it('dos cuentas con el mismo usuario pero puertos distintos abren conexiones separadas', () => {
    const cache = createProviderConnectionCache();
    const { factories, smtp } = fakeFactories();

    const enPuerto587 = resolveEmailProvider({ emailProvider: 'smtp', ...smtpEnv, smtpPort: '587', nodeEnv: 'production' }, cache, factories);
    const enPuerto465 = resolveEmailProvider({ emailProvider: 'smtp', ...smtpEnv, smtpPort: '465', nodeEnv: 'production' }, cache, factories);

    assert.notEqual(enPuerto587, enPuerto465);
    assert.equal(smtp.mock.calls.length, 2);
  });
});
