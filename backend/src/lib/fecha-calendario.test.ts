import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fechaCalendarioField, errorFechaCalendario } from './fecha-calendario.js';

function firstMessage(value: string): string | undefined {
  const result = fechaCalendarioField.safeParse(value);
  return result.success ? undefined : result.error.issues[0]?.message;
}

describe('fechaCalendarioField', () => {
  it('accepts a valid calendar date within the supported range', () => {
    assert.equal(fechaCalendarioField.safeParse('2026-09-22').success, true);
  });

  it('rejects a year below the minimum, mentioning the allowed range', () => {
    assert.equal(fechaCalendarioField.safeParse('1902-09-22').success, false);
    assert.match(firstMessage('1902-09-22') ?? '', /entre \d{4} y \d{4}/);
  });

  it('rejects the padded intermediate value produced while typing a year', () => {
    assert.equal(fechaCalendarioField.safeParse('0002-09-24').success, false);
  });

  it('rejects a day that does not exist', () => {
    assert.equal(fechaCalendarioField.safeParse('2026-02-30').success, false);
  });

  it('rejects a month that does not exist', () => {
    assert.equal(fechaCalendarioField.safeParse('2026-13-01').success, false);
  });

  it('rejects a malformed date with the format message', () => {
    assert.equal(firstMessage('26-09-22'), 'Formato de fecha inválido (se espera YYYY-MM-DD)');
  });
});

describe('errorFechaCalendario', () => {
  it('returns null for a valid calendar date', () => {
    assert.equal(errorFechaCalendario('Fecha de inicio', '2026-09-24'), null);
  });

  it('accepts an ISO datetime, validated by its date part', () => {
    assert.equal(errorFechaCalendario('Fecha de inicio', '2026-09-24T00:00:00.000Z'), null);
  });

  it('rejects a year below the minimum, mentioning the label', () => {
    const error = errorFechaCalendario('Fecha de inicio', '0026-09-24');
    assert.equal(typeof error, 'string');
    assert.match(error ?? '', /^Fecha de inicio inválida/);
  });

  it('rejects an undefined value, mentioning the label', () => {
    const error = errorFechaCalendario('Fecha de retorno', undefined);
    assert.equal(typeof error, 'string');
    assert.match(error ?? '', /^Fecha de retorno inválida/);
  });

  it('rejects a day that does not exist', () => {
    assert.equal(typeof errorFechaCalendario('Fecha de retorno', '2026-02-30'), 'string');
  });
});
