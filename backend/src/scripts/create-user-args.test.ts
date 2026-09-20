import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseCreateUserArgs } from './create-user-args.js';

describe('parseCreateUserArgs', () => {
  it('parses valid args with defaults (rol SOCIO, force false)', () => {
    const result = parseCreateUserArgs(['--email', 'foo@bar.com', '--name', 'Foo Bar']);
    assert.equal(result.success, true);
    if (result.success) {
      assert.deepEqual(result.data, { email: 'foo@bar.com', name: 'Foo Bar', rol: 'SOCIO', force: false });
    }
  });

  it('parses --rol ADMIN and --force', () => {
    const result = parseCreateUserArgs(['--email', 'a@b.com', '--name', 'Ada', '--rol', 'ADMIN', '--force']);
    assert.equal(result.success, true);
    if (result.success) {
      assert.equal(result.data.rol, 'ADMIN');
      assert.equal(result.data.force, true);
    }
  });

  it('trims and lowercases the email', () => {
    const result = parseCreateUserArgs(['--email', '  Foo@BAR.com  ', '--name', 'Foo']);
    assert.equal(result.success, true);
    if (result.success) {
      assert.equal(result.data.email, 'foo@bar.com');
    }
  });

  it('rejects an invalid rol value', () => {
    const result = parseCreateUserArgs(['--email', 'a@b.com', '--name', 'Ada', '--rol', 'OTHER']);
    assert.equal(result.success, false);
    if (!result.success) {
      assert.ok(result.errors.some((e) => e.includes('SOCIO')));
    }
  });

  it('rejects a lowercase rol value', () => {
    const result = parseCreateUserArgs(['--email', 'a@b.com', '--name', 'Ada', '--rol', 'admin']);
    assert.equal(result.success, false);
  });

  it('rejects a missing --email', () => {
    const result = parseCreateUserArgs(['--name', 'Ada']);
    assert.equal(result.success, false);
    if (!result.success) {
      assert.ok(result.errors.some((e) => e.includes('email')));
    }
  });

  it('rejects a missing --name', () => {
    const result = parseCreateUserArgs(['--email', 'a@b.com']);
    assert.equal(result.success, false);
    if (!result.success) {
      assert.ok(result.errors.some((e) => e.includes('nombre')));
    }
  });

  it('rejects an invalid email format', () => {
    const result = parseCreateUserArgs(['--email', 'not-an-email', '--name', 'Ada']);
    assert.equal(result.success, false);
    if (!result.success) {
      assert.ok(result.errors.some((e) => e.includes('email')));
    }
  });

  it('rejects an unknown flag', () => {
    const result = parseCreateUserArgs(['--email', 'a@b.com', '--name', 'Ada', '--bogus', 'x']);
    assert.equal(result.success, false);
  });

  it('rejects a positional argument', () => {
    const result = parseCreateUserArgs(['--email', 'a@b.com', '--name', 'Ada', 'extra']);
    assert.equal(result.success, false);
  });

  it('rejects a --password flag (there is no such flag)', () => {
    const result = parseCreateUserArgs(['--email', 'a@b.com', '--name', 'Ada', '--password', 'secret']);
    assert.equal(result.success, false);
  });
});
