import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { selectEmailProvider } from './get-email-provider.js';
import type { SelectEmailProviderParams } from './get-email-provider.js';

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
