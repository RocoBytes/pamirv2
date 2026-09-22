import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { describeTarget, isAllowedTarget } from './db-target.js';

const POOLED_URL = 'postgresql://user:s3cr3t@ep-abc-123-pooler.sa-east-1.aws.neon.tech/mydb?sslmode=require';
const DIRECT_URL = 'postgresql://user:s3cr3t@ep-abc-123.sa-east-1.aws.neon.tech/mydb?sslmode=require';
const OTHER_ENDPOINT_URL = 'postgresql://user:s3cr3t@ep-xyz-999-pooler.sa-east-1.aws.neon.tech/mydb?sslmode=require';

describe('isAllowedTarget', () => {
  it('matches a pooled Neon endpoint against its fragment', () => {
    assert.equal(isAllowedTarget(POOLED_URL, 'ep-abc-123'), true);
  });

  it('matches a non-pooled (direct) Neon endpoint against its fragment', () => {
    assert.equal(isAllowedTarget(DIRECT_URL, 'ep-abc-123'), true);
  });

  it('rejects a different endpoint', () => {
    assert.equal(isAllowedTarget(OTHER_ENDPOINT_URL, 'ep-abc-123'), false);
  });

  it('rejects an empty fragment', () => {
    assert.equal(isAllowedTarget(POOLED_URL, ''), false);
  });

  it('rejects a whitespace-only fragment', () => {
    assert.equal(isAllowedTarget(POOLED_URL, '   '), false);
  });

  it('rejects an undefined url', () => {
    assert.equal(isAllowedTarget(undefined, 'ep-abc-123'), false);
  });

  it('rejects a garbage url', () => {
    assert.equal(isAllowedTarget('not-a-url', 'ep-abc-123'), false);
  });

  it('rejects a fragment that only appears in the password', () => {
    const url = 'postgresql://user:ep-abc-123@otherhost.sa-east-1.aws.neon.tech/mydb';
    assert.equal(isAllowedTarget(url, 'ep-abc-123'), false);
  });

  it('rejects a fragment that only appears in the database name', () => {
    const url = 'postgresql://user:s3cr3t@otherhost.sa-east-1.aws.neon.tech/ep-abc-123';
    assert.equal(isAllowedTarget(url, 'ep-abc-123'), false);
  });
});

describe('describeTarget', () => {
  it('returns host and database without credentials', () => {
    const result = describeTarget(POOLED_URL);
    assert.deepEqual(result, { host: 'ep-abc-123-pooler.sa-east-1.aws.neon.tech', database: 'mydb' });
    assert.equal(JSON.stringify(result).includes('s3cr3t'), false);
    assert.equal(JSON.stringify(result).includes('user'), false);
  });

  it('returns null for an unparsable url', () => {
    assert.equal(describeTarget('not-a-url'), null);
  });
});
