import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isOrganizationSuspended } from './organization-status.js';

describe('isOrganizationSuspended', () => {
  it('devuelve true para un club SUSPENDED', () => {
    assert.equal(isOrganizationSuspended('SUSPENDED'), true);
  });

  it('devuelve false para un club ACTIVE', () => {
    assert.equal(isOrganizationSuspended('ACTIVE'), false);
  });
});
