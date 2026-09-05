import { Inject, Injectable } from '@nestjs/common';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.validation.js';
import { SETTINGS_STORE, type SettingsStore } from './ports.js';

export type LaunchCity = 'LAGOS' | 'ABUJA' | 'PORT_HARCOURT' | 'OTHER';

export interface EffectiveSettings {
  requireGuarantor: boolean;
  enforceRiderClearance: boolean;
  marketplaceEnabled: boolean;
  launchCity: LaunchCity;
  overridden: { requireGuarantor: boolean; enforceRiderClearance: boolean; marketplaceEnabled: boolean; launchCity: boolean };
}

/**
 * Effective operational config = stored admin override, falling back to the env default. Reads are
 * fail-closed: if the store errors, we use the env value (so a bad store can't, for example, silently
 * turn the rider-clearance gate off).
 */
@Injectable()
export class SettingsService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(SETTINGS_STORE) private readonly store: SettingsStore,
  ) {}

  private async raw(): Promise<Record<string, string>> {
    try { return await this.store.getAll(); } catch { return {}; }
  }

  async effective(): Promise<EffectiveSettings> {
    const o = await this.raw();
    return {
      requireGuarantor: 'requireGuarantor' in o ? o.requireGuarantor === 'true' : this.env.REQUIRE_GUARANTOR,
      enforceRiderClearance: 'enforceRiderClearance' in o ? o.enforceRiderClearance === 'true' : this.env.ENFORCE_RIDER_CLEARANCE,
      marketplaceEnabled: 'marketplaceEnabled' in o ? o.marketplaceEnabled === 'true' : this.env.MARKETPLACE_ENABLED,
      launchCity: ('launchCity' in o ? o.launchCity : this.env.LAUNCH_CITY) as LaunchCity,
      overridden: {
        requireGuarantor: 'requireGuarantor' in o,
        enforceRiderClearance: 'enforceRiderClearance' in o,
        marketplaceEnabled: 'marketplaceEnabled' in o,
        launchCity: 'launchCity' in o,
      },
    };
  }

  async requireGuarantor(): Promise<boolean> { return (await this.effective()).requireGuarantor; }
  async enforceRiderClearance(): Promise<boolean> { return (await this.effective()).enforceRiderClearance; }
  async marketplaceEnabled(): Promise<boolean> { return (await this.effective()).marketplaceEnabled; }
  async launchCity(): Promise<LaunchCity> { return (await this.effective()).launchCity; }

  async update(patch: { requireGuarantor?: boolean; enforceRiderClearance?: boolean; marketplaceEnabled?: boolean; launchCity?: LaunchCity }): Promise<EffectiveSettings> {
    const kv: Record<string, string> = {};
    if (patch.requireGuarantor !== undefined) kv.requireGuarantor = String(patch.requireGuarantor);
    if (patch.enforceRiderClearance !== undefined) kv.enforceRiderClearance = String(patch.enforceRiderClearance);
    if (patch.marketplaceEnabled !== undefined) kv.marketplaceEnabled = String(patch.marketplaceEnabled);
    if (patch.launchCity !== undefined) kv.launchCity = patch.launchCity;
    if (Object.keys(kv).length) await this.store.setMany(kv);
    return this.effective();
  }
}
