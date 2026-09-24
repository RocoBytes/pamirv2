import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveResetBrandingOrganizationId } from './reset-branding.js';

describe('resolveResetBrandingOrganizationId', () => {
  it('uses the request club when the person is a member of it', () => {
    const memberships = [{ organizationId: 'org-old' }, { organizationId: 'org-new' }];
    assert.equal(resolveResetBrandingOrganizationId(memberships, 'org-new'), 'org-new');
  });

  it('falls back to the oldest membership when there is no request club', () => {
    const memberships = [{ organizationId: 'org-old' }, { organizationId: 'org-new' }];
    assert.equal(resolveResetBrandingOrganizationId(memberships, null), 'org-old');
  });

  it('falls back to the oldest membership when the request club is not one of theirs', () => {
    const memberships = [{ organizationId: 'org-old' }, { organizationId: 'org-new' }];
    assert.equal(resolveResetBrandingOrganizationId(memberships, 'org-other'), 'org-old');
  });

  it('returns null when there are no memberships at all', () => {
    assert.equal(resolveResetBrandingOrganizationId([], null), null);
  });

  it('reduces to today\'s only membership when nobody sends X-Club yet (single-membership world, Global Constraint)', () => {
    const memberships = [{ organizationId: 'org-solo' }];
    assert.equal(resolveResetBrandingOrganizationId(memberships, null), 'org-solo');
  });
});
