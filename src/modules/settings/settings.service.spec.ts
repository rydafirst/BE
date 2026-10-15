/**
 * SettingsService — per-vehicle document toggles. An admin can hide a document for one vehicle track
 * without affecting others; the stored value round-trips and resolves per track.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SettingsService } from './settings.service.js';
import type { SettingsStore } from './ports.js';
import type { Env } from '../../config/env.validation.js';

function svc(envGlobal = ''): SettingsService {
  const kv = new Map<string, string>();
  const store: SettingsStore = {
    async getAll() { return Object.fromEntries(kv); },
    async setMany(patch) { for (const [k, v] of Object.entries(patch)) kv.set(k, v); },
  };
  const env = { MARKETPLACE_ENABLED: false, ENFORCE_RIDER_CLEARANCE: true, REQUIRE_GUARANTOR: false, LAUNCH_CITY: 'LAGOS', REFERRAL_REWARD_MINOR: 100000, DISABLED_DOC_TYPES: envGlobal } as unknown as Env;
  return new SettingsService(env, store);
}

test('hiding a document for one track leaves other tracks untouched', async () => {
  const s = svc();
  await s.update({ disabledDocByTrack: { CAR: ['INSURANCE', 'PROOF_OF_OWNERSHIP'] } });

  const eff = await s.effective();
  assert.deepEqual(eff.disabledDocByTrack.CAR?.sort(), ['INSURANCE', 'PROOF_OF_OWNERSHIP']);
  assert.equal(eff.disabledDocByTrack.BIKE, undefined, 'bike untouched');
  assert.equal(eff.overridden.disabledDocByTrack, true);

  assert.deepEqual((await s.disabledDocTypesForTrack('CAR')).sort(), ['INSURANCE', 'PROOF_OF_OWNERSHIP']);
  assert.deepEqual(await s.disabledDocTypesForTrack('BIKE'), []);
});

test('an env global default applies to every track until overridden', async () => {
  const s = svc('ROADWORTHINESS');
  const eff = await s.effective();
  assert.deepEqual(eff.disabledDocByTrack.CAR, ['ROADWORTHINESS']);
  assert.deepEqual(eff.disabledDocByTrack.BIKE, ['ROADWORTHINESS']);
  assert.equal(eff.overridden.disabledDocByTrack, false, 'from env, not overridden');

  // A stored map takes over completely.
  await s.update({ disabledDocByTrack: { KEKE: ['KEKE_PERMIT'] } });
  const eff2 = await s.effective();
  assert.deepEqual(eff2.disabledDocByTrack.KEKE, ['KEKE_PERMIT']);
  assert.equal(eff2.disabledDocByTrack.CAR, undefined, 'env global no longer applied once a map is stored');
});
