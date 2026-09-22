import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAlertRecipient } from './alert-recipient.js';

describe('resolveAlertRecipient', () => {
  it('fuera de producción, con override, usa el override', () => {
    const result = resolveAlertRecipient({
      orgAlertEmail: 'club@ejemplo.cl',
      override: 'dev@ejemplo.cl',
      nodeEnv: 'development',
    });
    assert.deepEqual(result, { recipient: 'dev@ejemplo.cl', overrideIgnored: false });
  });

  it('fuera de producción, recorta espacios del override', () => {
    const result = resolveAlertRecipient({
      orgAlertEmail: 'club@ejemplo.cl',
      override: '  dev@ejemplo.cl  ',
      nodeEnv: 'test',
    });
    assert.equal(result.recipient, 'dev@ejemplo.cl');
  });

  it('fuera de producción, sin override, usa el correo del club', () => {
    const result = resolveAlertRecipient({
      orgAlertEmail: 'club@ejemplo.cl',
      override: undefined,
      nodeEnv: 'development',
    });
    assert.deepEqual(result, { recipient: 'club@ejemplo.cl', overrideIgnored: false });
  });

  it('fuera de producción, override en blanco, usa el correo del club (no lo reporta como ignorado)', () => {
    const result = resolveAlertRecipient({
      orgAlertEmail: 'club@ejemplo.cl',
      override: '   ',
      nodeEnv: 'development',
    });
    assert.deepEqual(result, { recipient: 'club@ejemplo.cl', overrideIgnored: false });
  });

  it('en producción, con override, lo ignora y usa el correo del club', () => {
    const result = resolveAlertRecipient({
      orgAlertEmail: 'club@ejemplo.cl',
      override: 'dev@ejemplo.cl',
      nodeEnv: 'production',
    });
    assert.deepEqual(result, { recipient: 'club@ejemplo.cl', overrideIgnored: true });
  });

  it('en producción, sin override, usa el correo del club y no reporta nada ignorado', () => {
    const result = resolveAlertRecipient({
      orgAlertEmail: 'club@ejemplo.cl',
      override: undefined,
      nodeEnv: 'production',
    });
    assert.deepEqual(result, { recipient: 'club@ejemplo.cl', overrideIgnored: false });
  });

  it('en producción, override en blanco, no reporta nada ignorado', () => {
    const result = resolveAlertRecipient({
      orgAlertEmail: 'club@ejemplo.cl',
      override: '   ',
      nodeEnv: 'production',
    });
    assert.deepEqual(result, { recipient: 'club@ejemplo.cl', overrideIgnored: false });
  });

  it('nodeEnv undefined se trata como "no producción"', () => {
    const result = resolveAlertRecipient({
      orgAlertEmail: 'club@ejemplo.cl',
      override: 'dev@ejemplo.cl',
      nodeEnv: undefined,
    });
    assert.deepEqual(result, { recipient: 'dev@ejemplo.cl', overrideIgnored: false });
  });
});
