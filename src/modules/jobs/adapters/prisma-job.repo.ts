import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service.js';
import type { JobStatus } from '../domain/job-state-machine.js';
import type { Job, JobRepository } from '../ports.js';

@Injectable()
export class PrismaJobRepository implements JobRepository {
  constructor(private readonly db: PrismaService) {}

  async create(job: Job): Promise<void> {
    await this.db.job.create({
      data: {
        id: job.id, type: job.type, status: job.status, customerId: job.customerId,
        amountMinor: job.amountMinor, currency: job.currency, refundAccountId: job.refundAccountId,
        pickupLat: job.pickup.lat, pickupLng: job.pickup.lng,
        dropoffLat: job.dropoff.lat, dropoffLng: job.dropoff.lng,
        recipientName: job.recipient?.name ?? null, recipientPhone: job.recipient?.phone ?? null,
        fallbackPolicy: job.fallbackPolicy ?? null,
        flwTxRef: job.flwTxRef ?? null,
        flwTxId: job.flwTxId ?? null,
      },
    });
  }

  async find(id: string): Promise<Job | null> {
    const r = await this.db.job.findUnique({ where: { id } });
    if (!r) return null;
    return {
      id: r.id, type: r.type, status: r.status as JobStatus, customerId: r.customerId,
      ...(r.riderId ? { riderId: r.riderId } : {}),
      amountMinor: r.amountMinor, currency: 'NGN', refundAccountId: r.refundAccountId,
      pickup: { lat: r.pickupLat, lng: r.pickupLng }, dropoff: { lat: r.dropoffLat, lng: r.dropoffLng },
      ...(r.recipientName && r.recipientPhone ? { recipient: { name: r.recipientName, phone: r.recipientPhone } } : {}),
      ...(r.fallbackPolicy ? { fallbackPolicy: r.fallbackPolicy as Job['fallbackPolicy'] } : {}),
      ...(r.flwTxRef ? { flwTxRef: r.flwTxRef } : {}),
      ...(r.flwTxId ? { flwTxId: r.flwTxId } : {}),
      ...(r.arrivedAt ? { arrivedAt: r.arrivedAt.getTime() } : {}),
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

  async findByTxRef(txRef: string): Promise<Job | null> {
    const r = await this.db.job.findUnique({ where: { flwTxRef: txRef } });
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
}
