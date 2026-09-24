import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { xClubHeader } from './x-club.js';

describe('xClubHeader', () => {
  it('returns the header value when present', () => {
    assert.equal(xClubHeader({ headers: { 'x-club': 'el-montanista' } }), 'el-montanista');
  });

  it('returns undefined when absent', () => {
    assert.equal(xClubHeader({ headers: {} }), undefined);
  });

  it('trims surrounding whitespace', () => {
    assert.equal(xClubHeader({ headers: { 'x-club': '  testing  ' } }), 'testing');
  });

  it('treats an empty or whitespace-only header as absent', () => {
    assert.equal(xClubHeader({ headers: { 'x-club': '   ' } }), undefined);
  });

  it('takes the first value when the header repeats', () => {
    assert.equal(xClubHeader({ headers: { 'x-club': ['a', 'b'] } }), 'a');
  });
});
