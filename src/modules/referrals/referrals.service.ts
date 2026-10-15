import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { REFERRAL_REPO, type ReferralRecord, type ReferralRepository } from './ports.js';
import { USER_REPO, type UserRepository } from '../auth/ports.js';
import { JobsService } from '../jobs/jobs.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { AccountRiderPayout } from '../accounts/adapters/account-rider-payout.js';
import { PAYMENT_PROVIDER, type PaymentProvider } from '../payments/payment-provider.interface.js';
import { Money } from '../payments/domain/money.js';
import { isDeliveryComplete } from '../jobs/domain/job-state-machine.js';

// Shareable link base. Riders register on the web, so the link always points at the web rider sign-up
// with the code pre-filled.
const WEB_BASE = process.env.PUBLIC_WEB_URL || 'https://rydafirst.com';
// Unambiguous alphabet (no 0/O, 1/I/L) so a code is easy to read aloud and type.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LEN = 6;

export interface MyReferral {
  enabled: boolean;    // whether the referral program is currently on
  code: string;
  link: string;
  rewardMinor: number; // what a referrer earns per qualified rider (current)
  invited: number;     // riders who signed up with this code
  pending: number;     // not yet credited
  credited: number;    // credited
  earnedMinor: number; // total credited to this rider
}

export interface AdminReferralRow {
  id: string;
  status: ReferralRecord['status'];
  createdAt: number;
  referrer: { id: string; name: string | null; phone: string | null };
  referee: { id: string; name: string | null; phone: string | null };
  refereeDeliveries: number; // completed deliveries by the referred rider
  qualified: boolean;        // pending AND the referred rider has completed >= 1 delivery
  rewardMinor: number;       // credited amount (or the current reward, for a pending row)
  creditedAt?: number;
  payoutRef?: string;
  payoutError?: string;
}

/**
 * Rider-to-rider referrals. A rider shares a code/link; a new rider enters it at sign-up (web). The
 * reward is paid to the referrer only after the referred rider completes their FIRST delivery and an
 * admin credits it — the hardest-to-game trigger. Crediting pays the referrer by bank transfer using
 * the same processor as delivery earnings, recorded on the referral row (kept out of the escrow ledger
 * so job-money reconciliation is never affected).
 */
@Injectable()
export class ReferralsService {
  private readonly log = new Logger(ReferralsService.name);
  constructor(
    @Inject(REFERRAL_REPO) private readonly repo: ReferralRepository,
    @Inject(USER_REPO) private readonly users: UserRepository,
    private readonly jobs: JobsService,
    private readonly settings: SettingsService,
    private readonly payout: AccountRiderPayout,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
  ) {}

  /** The rider's referral code + link + running totals. Generates the code on first access. */
  async mine(riderId: string): Promise<MyReferral> {
    const code = await this.ensureCode(riderId);
    const [rows, rewardMinor, enabled] = await Promise.all([
      this.repo.listByReferrer(riderId),
      this.settings.referralRewardMinor(),
      this.settings.referralsEnabled(),
    ]);
    const credited = rows.filter((r) => r.status === 'CREDITED');
    return {
      enabled,
      code,
      link: `${WEB_BASE}/login?role=rider&ref=${code}`,
      rewardMinor,
      invited: rows.length,
      pending: rows.filter((r) => r.status === 'PENDING').length,
      credited: credited.length,
      earnedMinor: credited.reduce((s, r) => s + r.rewardMinor, 0),
    };
  }

  /** A new rider enters a referral code at sign-up (before their first delivery). Riders only. */
  async claim(refereeId: string, rawCode: string): Promise<{ ok: true }> {
    if (!(await this.settings.referralsEnabled())) throw new ConflictException('Referrals are not available right now');
    const code = rawCode.trim().toUpperCase();
    if (!code) throw new BadRequestException('Enter a referral code');

    const referrer = await this.users.findByReferralCode(code);
    if (!referrer || referrer.role !== 'RIDER') throw new BadRequestException('That referral code is not valid');
    if (referrer.id === refereeId) throw new BadRequestException('You cannot use your own referral code');

    const existing = await this.repo.findByReferee(refereeId);
    if (existing) {
      if (existing.referrerId === referrer.id) return { ok: true }; // idempotent re-submit
      throw new ConflictException('A referral code has already been applied to your account');
    }
    // Only a genuinely new rider may attach a code — not someone who has already been delivering.
    if ((await this.completedDeliveries(refereeId)) > 0) {
      throw new ConflictException('A referral code can only be added before your first delivery');
    }
    await this.repo.create({ referrerId: referrer.id, refereeId });
    return { ok: true };
  }

  /** Admin: every referral, enriched with both parties and the referred rider's qualification. */
  async adminList(): Promise<{ rewardMinor: number; items: AdminReferralRow[] }> {
    const [all, rewardMinor] = await Promise.all([this.repo.listAll(), this.settings.referralRewardMinor()]);
    const items = await Promise.all(all.map(async (r): Promise<AdminReferralRow> => {
      const [referrer, referee, refereeDeliveries] = await Promise.all([
        this.users.getBrief(r.referrerId),
        this.users.getBrief(r.refereeId),
        this.completedDeliveries(r.refereeId),
      ]);
      return {
        id: r.id,
        status: r.status,
        createdAt: r.createdAt,
        referrer: { id: r.referrerId, name: referrer?.name ?? null, phone: referrer?.phone ?? null },
        referee: { id: r.refereeId, name: referee?.name ?? null, phone: referee?.phone ?? null },
        refereeDeliveries,
        qualified: r.status === 'PENDING' && refereeDeliveries > 0,
        rewardMinor: r.status === 'CREDITED' ? r.rewardMinor : rewardMinor,
        ...(r.creditedAt ? { creditedAt: r.creditedAt } : {}),
        ...(r.payoutRef ? { payoutRef: r.payoutRef } : {}),
        ...(r.payoutError ? { payoutError: r.payoutError } : {}),
      };
    }));
    return { rewardMinor, items };
  }

  /**
   * Admin credits a qualified referral: pays the referrer the current reward by bank transfer and marks
   * it CREDITED. Idempotent — a repeat on an already-credited row is a no-op, and the transfer uses a
   * stable reference so a retry never double-pays.
   */
  async credit(referralId: string, adminId: string): Promise<ReferralRecord> {
    const rec = await this.repo.get(referralId);
    if (!rec) throw new NotFoundException('Referral not found');
    if (rec.status === 'CREDITED') return rec; // already paid
    if (rec.status === 'REJECTED') throw new ConflictException('This referral was rejected');

    if ((await this.completedDeliveries(rec.refereeId)) < 1) {
      throw new ConflictException('The referred rider has not completed a delivery yet');
    }
    const rewardMinor = await this.settings.referralRewardMinor();

    let payoutRef: string | undefined;
    if (rewardMinor > 0) {
      const bank = await this.payout.getPayout(rec.referrerId);
      if (!bank) throw new ConflictException('The referrer has no payout bank account on file yet');
      try {
        const r = await this.provider.transfer({
          amount: Money.of(rewardMinor),
          bankCode: bank.bankCode,
          accountNumber: bank.accountNumber,
          reference: `referral:${rec.id}`, // stable ⇒ idempotent at the processor
          narration: 'Rydafirst referral bonus',
        });
        payoutRef = r.providerRef;
      } catch (e) {
        const reason = e instanceof Error ? e.message : 'transfer failed';
        this.log.error(`Referral payout failed for ${rec.id}: ${reason}`);
        await this.repo.update(rec.id, { payoutError: reason });
        throw new ConflictException(`Could not pay the referrer: ${reason}`);
      }
    }
    return this.repo.update(rec.id, {
      status: 'CREDITED', rewardMinor, creditedAt: Date.now(), creditedBy: adminId,
      ...(payoutRef ? { payoutRef } : {}), payoutError: undefined,
    });
  }

  /** Admin rejects a referral (e.g. suspected abuse). */
  async reject(referralId: string, _adminId: string): Promise<ReferralRecord> {
    const rec = await this.repo.get(referralId);
    if (!rec) throw new NotFoundException('Referral not found');
    if (rec.status === 'CREDITED') throw new ConflictException('This referral was already credited');
    return this.repo.update(rec.id, { status: 'REJECTED' });
  }

  // ---- helpers ----
  private async completedDeliveries(riderId: string): Promise<number> {
    const jobs = await this.jobs.jobsForRider(riderId);
    return jobs.filter((j) => isDeliveryComplete(j.status)).length;
  }

  private async ensureCode(riderId: string): Promise<string> {
    const existing = await this.users.getReferralCode(riderId);
    if (existing) return existing;
    for (let attempt = 0; attempt < 6; attempt++) {
      const code = this.newCode();
      try {
        await this.users.setReferralCode(riderId, code);
        return code;
      } catch {
        // Collision (unique index) — try another. Re-read in case a concurrent call just set one.
        const now = await this.users.getReferralCode(riderId);
        if (now) return now;
      }
    }
    throw new ConflictException('Could not generate a referral code, please try again');
  }

  private newCode(): string {
    const bytes = randomBytes(CODE_LEN);
    let out = '';
    for (let i = 0; i < CODE_LEN; i++) out += CODE_ALPHABET[bytes[i]! % CODE_ALPHABET.length];
    return out;
  }
}
