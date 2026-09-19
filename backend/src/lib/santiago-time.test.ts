import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { santiagoOffsetFor, instanteSantiago } from './santiago-time.js';

describe('santiagoOffsetFor', () => {
  it('returns the summer offset for a Chilean summer date', () => {
    assert.equal(santiagoOffsetFor('2026-01-15'), '-03:00');
  });

  it('returns the winter offset for a Chilean winter date', () => {
    assert.equal(santiagoOffsetFor('2026-06-15'), '-04:00');
  });
});

describe('instanteSantiago', () => {
  it('builds the UTC instant for a Santiago wall-clock time', () => {
    assert.equal(instanteSantiago('2026-09-22', '23:59').toISOString(), '2026-09-23T02:59:00.000Z');
  });

  it('throws instead of returning an Invalid Date for historical years with a seconds-offset', () => {
    assert.throws(() => instanteSantiago('1902-09-22', '23:59'));
  });

  it('throws for a nonexistent calendar date', () => {
    assert.throws(() => instanteSantiago('2026-13-01', '10:00'));
  });
});
