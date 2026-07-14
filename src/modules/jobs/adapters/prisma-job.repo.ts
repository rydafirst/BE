import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service.js';
import type { JobStatus } from '../domain/job-state-machine.js';
import type { Job, JobRepository } from '../ports.js';

@Injectable()
export class PrismaJobRepository implements JobRepository {
  constructor(private readonly db: PrismaService) {}

  async create(job: Job): Promise<void> {
    // `data` is cast because migration 20260714000000_job_fee_payout adds columns
    // (platformFeeMinor, payout*) that the generated client only knows after `prisma generate`,
    // which runs on deploy but is blocked in this sandbox. Runtime values are correct.
    const data = {
      id: job.id, type: job.type, status: job.status, customerId: job.customerId,
      amountMinor: job.amountMinor, currency: job.currency, refundAccountId: job.refundAccountId,
      platformFeeMinor: job.platformFeeMinor ?? null,
      pickupLat: job.pickup.lat, pickupLng: job.pickup.lng,
      dropoffLat: job.dropoff.lat, dropoffLng: job.dropoff.lng,
      pickupAddress: job.pickupAddress ?? null, dropoffAddress: job.dropoffAddress ?? null,
      pickupArea: job.pickupArea ?? null, dropoffArea: job.dropoffArea ?? null,
      recipientName: job.recipient?.name ?? null, recipientPhone: job.recipient?.phone ?? null,
      item: job.item ?? null, weightGrams: job.weightGrams ?? null, customerName: job.customerName ?? null, instructions: job.instructions ?? null,
      fallbackPolicy: job.fallbackPolicy ?? null,
      flwTxRef: job.flwTxRef ?? null,
      flwTxId: job.flwTxId ?? null,
      returnOfJobId: job.returnOfJobId ?? null,
      waitingTxRef: job.waitingTxRef ?? null,
      waitingTxId: job.waitingTxId ?? null,
      waitingFeeMinor: job.waitingFeeMinor ?? null,
      returnReserveMinor: job.returnReserveMinor ?? null,
    };
    await this.db.job.create({ data: data as never });
  }

  async find(id: string): Promise<Job | null> {
    const r = await this.db.job.findUnique({ where: { id } });
    if (!r) return null;
    // New columns (migration 20260714000000) read via a cast until the client is regenerated.
    const x = r as typeof r & {
      platformFeeMinor: number | null; payoutPending: boolean | null;
      payoutError: string | null; payoutRef: string | null;
      waitStartedAt: Date | null; returnOfJobId: string | null;
      waitingTxRef: string | null; waitingTxId: string | null; waitingFeeMinor: number | null;
      returnReserveMinor: number | null; weightGrams: number | null; customerName: string | null;
    };
    return {
      id: r.id, type: r.type, status: r.status as JobStatus, customerId: r.customerId,
      ...(x.customerName ? { customerName: x.customerName } : {}),
      ...(r.riderId ? { riderId: r.riderId } : {}),
      amountMinor: r.amountMinor, currency: 'NGN', refundAccountId: r.refundAccountId,
      ...(x.platformFeeMinor != null ? { platformFeeMinor: x.platformFeeMinor } : {}),
      ...(x.payoutPending ? { payoutPending: true } : {}),
      ...(x.payoutError ? { payoutError: x.payoutError } : {}),
      ...(x.payoutRef ? { payoutRef: x.payoutRef } : {}),
      pickup: { lat: r.pickupLat, lng: r.pickupLng }, dropoff: { lat: r.dropoffLat, lng: r.dropoffLng },
      ...(r.pickupAddress ? { pickupAddress: r.pickupAddress } : {}),
      ...(r.dropoffAddress ? { dropoffAddress: r.dropoffAddress } : {}),
      ...(r.pickupArea ? { pickupArea: r.pickupArea } : {}),
      ...(r.dropoffArea ? { dropoffArea: r.dropoffArea } : {}),
      ...(r.recipientName && r.recipientPhone ? { recipient: { name: r.recipientName, phone: r.recipientPhone } } : {}),
      ...(r.item ? { item: r.item } : {}),
      ...(x.weightGrams != null ? { weightGrams: x.weightGrams } : {}),
      ...(r.instructions ? { instructions: r.instructions } : {}),
      ...(r.fallbackPolicy ? { fallbackPolicy: r.fallbackPolicy as Job['fallbackPolicy'] } : {}),
      ...(r.flwTxRef ? { flwTxRef: r.flwTxRef } : {}),
      ...(r.flwTxId ? { flwTxId: r.flwTxId } : {}),
      ...(r.arrivedAt ? { arrivedAt: r.arrivedAt.getTime() } : {}),
      ...(x.waitStartedAt ? { waitStartedAt: x.waitStartedAt.getTime() } : {}),
      ...(x.returnOfJobId ? { returnOfJobId: x.returnOfJobId } : {}),
      ...(x.waitingTxRef ? { waitingTxRef: x.waitingTxRef } : {}),
      ...(x.waitingTxId ? { waitingTxId: x.waitingTxId } : {}),
      ...(x.waitingFeeMinor != null ? { waitingFeeMinor: x.waitingFeeMinor } : {}),
      ...(x.returnReserveMinor != null ? { returnReserveMinor: x.returnReserveMinor } : {}),
      createdAt: r.createdAt.toISOString(),
    };
  }

  async updateStatus(id: string, status: JobStatus): Promise<void> {
    await this.db.job.update({ where: { id }, data: { status } });
  }

  /** Race-safe accept: a conditional UPDATE that only succeeds while status is SEARCHING. */
  async claim(id: string, riderId: string): Promise<boolean> {
    const res = await this.db.job.updateMany({
      where: { id, status: 'SEARCHING' },
      data: { status: 'ACCEPTED', riderId },
    });
    return res.count === 1; // exactly one row updated => this rider won the race
  }

  /** Release back to the pool: clear the rider and reopen for matching. */
  async release(id: string): Promise<void> {
    await this.db.job.update({ where: { id }, data: { status: 'SEARCHING', riderId: null } });
  }

  async findByTxRef(txRef: string): Promise<Job | null> {
    const r = await this.db.job.findFirst({ where: { OR: [{ flwTxRef: txRef }, { waitingTxRef: txRef } as never] } });
    return r ? this.find(r.id) : null;
  }
  async setPaymentRefs(id: string, refs: { txRef?: string; txId?: string }): Promise<void> {
    await this.db.job.update({ where: { id }, data: {
      ...(refs.txRef !== undefined ? { flwTxRef: refs.txRef } : {}),
      ...(refs.txId !== undefined ? { flwTxId: refs.txId } : {}),
    } });
  }
  async setArrivedAt(id: string, atMs: number): Promise<void> {
    await this.db.job.update({ where: { id }, data: { arrivedAt: new Date(atMs) } });
  }
  async setWaitStartedAt(id: string, atMs: number): Promise<void> {
    await this.db.job.update({ where: { id }, data: { waitStartedAt: new Date(atMs) } as never });
  }
  async setWaitingRefs(id: string, refs: { txRef?: string; txId?: string; feeMinor?: number }): Promise<void> {
    await this.db.job.update({ where: { id }, data: {
      ...(refs.txRef !== undefined ? { waitingTxRef: refs.txRef } : {}),
      ...(refs.txId !== undefined ? { waitingTxId: refs.txId } : {}),
      ...(refs.feeMinor !== undefined ? { waitingFeeMinor: refs.feeMinor } : {}),
    } as never });
  }
  async setPayoutState(id: string, state: { pending: boolean; error?: string | null; ref?: string | null }): Promise<void> {
    const data = {
      payoutPending: state.pending,
      ...(state.error !== undefined ? { payoutError: state.error } : {}),
      ...(state.ref !== undefined ? { payoutRef: state.ref } : {}),
    };
    await this.db.job.update({ where: { id }, data: data as never });
  }
  async listPayoutPending(limit: number): Promise<Job[]> {
    const rows = await this.db.job.findMany({ where: { payoutPending: true } as never, take: limit, select: { id: true } });
    const out: Job[] = [];
    for (const r of rows) { const j = await this.find(r.id); if (j) out.push(j); }
    return out;
  }
  async listByRider(riderId: string): Promise<Job[]> {
    const rows = await this.db.job.findMany({ where: { riderId } });
    const out: Job[] = [];
    for (const r of rows) { const j = await this.find(r.id); if (j) out.push(j); }
    return out;
  }
  async listByCustomer(customerId: string): Promise<Job[]> {
    const rows = await this.db.job.findMany({ where: { customerId } });
    const out: Job[] = [];
    for (const r of rows) { const j = await this.find(r.id); if (j) out.push(j); }
    return out;
  }

  async listActive(): Promise<Job[]> {
    const rows = await this.db.job.findMany({
      where: { status: { notIn: ['RELEASED', 'CANCELLED', 'DISPUTE_RESOLVED'] } },
    });
    const out: Job[] = [];
    for (const r of rows) { const j = await this.find(r.id); if (j) out.push(j); }
    return out;
  }
  async listRecent(limit: number): Promise<Job[]> {
    const rows = await this.db.job.findMany({ orderBy: { createdAt: 'desc' }, take: limit, select: { id: true } });
    const out: Job[] = [];
    for (const r of rows) { const j = await this.find(r.id); if (j) out.push(j); }
    return out;
  }
}
