import { Inject, Injectable } from '@nestjs/common';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.validation.js';
import { SETTINGS_STORE, type SettingsStore } from './ports.js';

export type LaunchCity = 'LAGOS' | 'ABUJA' | 'PORT_HARCOURT' | 'OTHER';

export interface EffectiveSettings {
  requireGuarantor: boolean;
  enforceRiderClearance: boolean;
  marketplaceEnabled: boolean;
  lateMoneyPenaltyEnabled: boolean;
  launchCity: LaunchCity;
  referralRewardMinor: number;
  referralsEnabled: boolean;
  economyDiscountPct: number;
  /** Rider document types switched OFF, PER VEHICLE TRACK (e.g. { CAR: ['INSURANCE'] }). Hidden on every client. */
  disabledDocByTrack: Record<string, string[]>;
  overridden: { requireGuarantor: boolean; enforceRiderClearance: boolean; marketplaceEnabled: boolean; lateMoneyPenaltyEnabled: boolean; launchCity: boolean; referralRewardMinor: boolean; referralsEnabled: boolean; economyDiscountPct: boolean; disabledDocByTrack: boolean };
}

const TRACKS_FOR_SETTINGS = ['BIKE', 'CAR', 'KEKE', 'BICYCLE'] as const;

/** Economy discount is a sane percentage: 0–90, integer. */
function clampPct(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(90, Math.max(0, Math.round(n)));
}

/** Parse the stored per-track disable map (JSON), falling back to an env global list applied to every track. */
function parseDisabledByTrack(stored: string | undefined, envGlobal: string): Record<string, string[]> {
  if (stored) {
    try {
      const obj = JSON.parse(stored) as Record<string, unknown>;
      const out: Record<string, string[]> = {};
      for (const tr of TRACKS_FOR_SETTINGS) {
        const list = obj[tr];
        if (Array.isArray(list)) out[tr] = list.map(String).map((s) => s.trim()).filter(Boolean);
      }
      return out;
    } catch { /* fall through to env */ }
  }
  const global = envGlobal.split(',').map((s) => s.trim()).filter(Boolean);
  if (global.length === 0) return {};
  return Object.fromEntries(TRACKS_FOR_SETTINGS.map((tr) => [tr, [...global]]));
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
      lateMoneyPenaltyEnabled: 'lateMoneyPenaltyEnabled' in o ? o.lateMoneyPenaltyEnabled === 'true' : this.env.LATE_MONEY_PENALTY_ENABLED,
      launchCity: ('launchCity' in o ? o.launchCity : this.env.LAUNCH_CITY) as LaunchCity,
      referralRewardMinor: 'referralRewardMinor' in o ? Math.max(0, Number(o.referralRewardMinor) || 0) : this.env.REFERRAL_REWARD_MINOR,
      referralsEnabled: 'referralsEnabled' in o ? o.referralsEnabled === 'true' : this.env.REFERRALS_ENABLED,
      economyDiscountPct: 'economyDiscountPct' in o ? clampPct(Number(o.economyDiscountPct)) : this.env.ECONOMY_DISCOUNT_PCT,
      disabledDocByTrack: parseDisabledByTrack(o.disabledDocByTrack, this.env.DISABLED_DOC_TYPES ?? ''),
      overridden: {
        requireGuarantor: 'requireGuarantor' in o,
        enforceRiderClearance: 'enforceRiderClearance' in o,
        marketplaceEnabled: 'marketplaceEnabled' in o,
        lateMoneyPenaltyEnabled: 'lateMoneyPenaltyEnabled' in o,
        launchCity: 'launchCity' in o,
        referralRewardMinor: 'referralRewardMinor' in o,
        referralsEnabled: 'referralsEnabled' in o,
        economyDiscountPct: 'economyDiscountPct' in o,
        disabledDocByTrack: 'disabledDocByTrack' in o,
      },
    };
  }

  async referralsEnabled(): Promise<boolean> { return (await this.effective()).referralsEnabled; }
  async economyDiscountPct(): Promise<number> { return (await this.effective()).economyDiscountPct; }

  /** Document types switched off for a specific vehicle track. */
  async disabledDocTypesForTrack(track: string): Promise<string[]> {
    return (await this.effective()).disabledDocByTrack[track] ?? [];
  }

  async referralRewardMinor(): Promise<number> { return (await this.effective()).referralRewardMinor; }

  async requireGuarantor(): Promise<boolean> { return (await this.effective()).requireGuarantor; }
  async enforceRiderClearance(): Promise<boolean> { return (await this.effective()).enforceRiderClearance; }
  async marketplaceEnabled(): Promise<boolean> { return (await this.effective()).marketplaceEnabled; }
  async lateMoneyPenaltyEnabled(): Promise<boolean> { return (await this.effective()).lateMoneyPenaltyEnabled; }
  async launchCity(): Promise<LaunchCity> { return (await this.effective()).launchCity; }

  async update(patch: { requireGuarantor?: boolean; enforceRiderClearance?: boolean; marketplaceEnabled?: boolean; lateMoneyPenaltyEnabled?: boolean; launchCity?: LaunchCity; referralRewardMinor?: number; referralsEnabled?: boolean; economyDiscountPct?: number; disabledDocByTrack?: Record<string, string[]> }): Promise<EffectiveSettings> {
    const kv: Record<string, string> = {};
    if (patch.requireGuarantor !== undefined) kv.requireGuarantor = String(patch.requireGuarantor);
    if (patch.enforceRiderClearance !== undefined) kv.enforceRiderClearance = String(patch.enforceRiderClearance);
    if (patch.marketplaceEnabled !== undefined) kv.marketplaceEnabled = String(patch.marketplaceEnabled);
    if (patch.lateMoneyPenaltyEnabled !== undefined) kv.lateMoneyPenaltyEnabled = String(patch.lateMoneyPenaltyEnabled);
    if (patch.launchCity !== undefined) kv.launchCity = patch.launchCity;
    if (patch.referralRewardMinor !== undefined) kv.referralRewardMinor = String(Math.max(0, Math.round(patch.referralRewardMinor)));
    if (patch.referralsEnabled !== undefined) kv.referralsEnabled = String(patch.referralsEnabled);
    if (patch.economyDiscountPct !== undefined) kv.economyDiscountPct = String(clampPct(patch.economyDiscountPct));
    // Stored as JSON: { TRACK: [types] }. Only known tracks with non-empty lists are kept.
    if (patch.disabledDocByTrack !== undefined) {
      const clean: Record<string, string[]> = {};
      for (const tr of TRACKS_FOR_SETTINGS) {
        const list = patch.disabledDocByTrack[tr];
        if (Array.isArray(list) && list.length) clean[tr] = [...new Set(list.map((s) => s.trim()).filter(Boolean))];
      }
      kv.disabledDocByTrack = JSON.stringify(clean);
    }
    if (Object.keys(kv).length) await this.store.setMany(kv);
    return this.effective();
  }
}
