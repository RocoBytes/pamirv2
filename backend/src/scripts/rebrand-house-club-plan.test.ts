import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { planRebrand } from './rebrand-house-club-plan.js';

const PAMIR_HOY = {
  slug: 'pamir',
  name: 'Andino Club Pamir',
  shortName: 'Pamir',
  membresiaPropia: 'SOCIO_ANDINO_PAMIR',
  logoObjectKey: null,
};

describe('planRebrand', () => {
  it('sin "pamir" y con "riala" ya existente: ya aplicado', () => {
    const plan = planRebrand({ pamirOrg: null, rialaExists: true });
    assert.deepEqual(plan, { kind: 'already-applied' });
  });

  it('sin "pamir" ni "riala": nada que hacer', () => {
    const plan = planRebrand({ pamirOrg: null, rialaExists: false });
    assert.deepEqual(plan, { kind: 'pamir-not-found' });
  });

  it('con "pamir" en su estado de hoy: arma el diff completo (slug, name, shortName, membresiaPropia)', () => {
    const plan = planRebrand({ pamirOrg: PAMIR_HOY, rialaExists: false });
    assert.equal(plan.kind, 'plan');
    if (plan.kind !== 'plan') return;
    assert.deepEqual(plan.changes, [
      { campo: 'slug', antes: 'pamir', despues: 'riala' },
      { campo: 'name', antes: 'Andino Club Pamir', despues: 'RIALA' },
      { campo: 'shortName', antes: 'Pamir', despues: 'RIALA' },
      { campo: 'membresiaPropia', antes: 'SOCIO_ANDINO_PAMIR', despues: 'SOCIO_RIALA' },
    ]);
  });

  it('incluye el borrado del logo solo cuando logoObjectKey no es null', () => {
    const plan = planRebrand({
      pamirOrg: { ...PAMIR_HOY, logoObjectKey: 'orgs/org-pamir/logo/abc.png' },
      rialaExists: false,
    });
    assert.equal(plan.kind, 'plan');
    if (plan.kind !== 'plan') return;
    assert.deepEqual(plan.changes.at(-1), {
      campo: 'logoObjectKey',
      antes: 'orgs/org-pamir/logo/abc.png',
      despues: '(borrado)',
    });
  });

  it('shortName null se reporta como "(sin nombre corto)" en el "antes"', () => {
    const plan = planRebrand({ pamirOrg: { ...PAMIR_HOY, shortName: null }, rialaExists: false });
    assert.equal(plan.kind, 'plan');
    if (plan.kind !== 'plan') return;
    const cambioShortName = plan.changes.find((c) => c.campo === 'shortName');
    assert.deepEqual(cambioShortName, { campo: 'shortName', antes: '(sin nombre corto)', despues: 'RIALA' });
  });

  it('"pamir" que ya tiene todos los valores objetivo: diff vacío (idempotente)', () => {
    const plan = planRebrand({
      pamirOrg: {
        slug: 'riala',
        name: 'RIALA',
        shortName: 'RIALA',
        membresiaPropia: 'SOCIO_RIALA',
        logoObjectKey: null,
      },
      rialaExists: false,
    });
    assert.deepEqual(plan, { kind: 'plan', changes: [] });
  });
});
