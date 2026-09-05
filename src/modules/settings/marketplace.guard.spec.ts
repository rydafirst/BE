/**
 * Marketplace master switch — the guard is the real enforcement (hiding the UI is only cosmetic).
 * Proves it refuses when off and allows when on, and that the default is OFF (safe until legal sign-off).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MarketplaceGuard } from './marketplace.guard.js';
import { SettingsService } from './settings.service.js';
import type { SettingsStore } from './ports.js';
import type { Env } from '../../config/env.validation.js';

function svc(stored: Record<string, string>, envDefault = false): SettingsService {
  const store: SettingsStore = { async getAll() { return stored; }, async setMany() { /* noop */ } };
  const env = { MARKETPLACE_ENABLED: envDefault, ENFORCE_RIDER_CLEARANCE: true, REQUIRE_GUARANTOR: false, LAUNCH_CITY: 'LAGOS' } as unknown as Env;
  return new SettingsService(env, store);
}

test('default is OFF: the guard refuses when nothing is stored and the env default is false', async () => {
  const guard = new MarketplaceGuard(svc({}));
  await assert.rejects(guard.canActivate(), /unavailable/i);
});

test('admin turns it ON: the guard allows once the setting is stored true', async () => {
  const guard = new MarketplaceGuard(svc({ marketplaceEnabled: 'true' }));
  assert.equal(await guard.canActivate(), true);
});

test('admin turns it OFF: an explicit stored false refuses even if the env default is true', async () => {
  const guard = new MarketplaceGuard(svc({ marketplaceEnabled: 'false' }, true));
  await assert.rejects(guard.canActivate(), /unavailable/i);
});

test('fail-closed: a broken store falls back to the env default (off) and refuses', async () => {
  const store: SettingsStore = { async getAll() { throw new Error('store down'); }, async setMany() { /* noop */ } };
  const env = { MARKETPLACE_ENABLED: false } as unknown as Env;
  const guard = new MarketplaceGuard(new SettingsService(env, store));
  await assert.rejects(guard.canActivate(), /unavailable/i);
});
