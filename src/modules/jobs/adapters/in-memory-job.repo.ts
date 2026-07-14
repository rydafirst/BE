import { Injectable } from '@nestjs/common';
import type { JobStatus } from '../domain/job-state-machine.js';
import type { Job, JobRepository } from '../ports.js';

// DEV ONLY. Replace with Postgres (jobs + job_events append-only) in the persistence phase.
@Injectable()
export class InMemoryJobRepo implements JobRepository {
  private m = new Map<string, Job>();
  async create(job: Job): Promise<void> { this.m.set(job.id, { ...job }); }
  async find(id: string): Promise<Job | null> { return this.m.get(id) ?? null; }
  async updateStatus(id: string, status: JobStatus): Promise<void> {
    const j = this.m.get(id); if (j) j.status = status;
  }
  async listActive(): Promise<Job[]> {
    return [...this.m.values()];
  }
  async listRecent(limit: number): Promise<Job[]> {
    return [...this.m.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
  }
  async listByRider(riderId: string): Promise<Job[]> {
    return [...this.m.values()].filter((j) => j.riderId === riderId);
  }
  async listByCustomer(customerId: string): Promise<Job[]> {
    return [...this.m.values()].filter((j) => j.customerId === customerId);
  }
  async findByTxRef(txRef: string): Promise<Job | null> {
    return [...this.m.values()].find((j) => j.flwTxRef === txRef || j.waitingTxRef === txRef) ?? null;
  }
  async setArrivedAt(id: string, atMs: number): Promise<void> {
    const j = this.m.get(id); if (j) j.arrivedAt = atMs;
  }
  async setWaitStartedAt(id: string, atMs: number): Promise<void> {
    const j = this.m.get(id); if (j) j.waitStartedAt = atMs;
  }
  async setWaitingRefs(id: string, refs: { txRef?: string; txId?: string; feeMinor?: number }): Promise<void> {
    const j = this.m.get(id);
    if (!j) return;
    if (refs.txRef !== undefined) j.waitingTxRef = refs.txRef;
    if (refs.txId !== undefined) j.waitingTxId = refs.txId;
    if (refs.feeMinor !== undefined) j.waitingFeeMinor = refs.feeMinor;
  }
  async setPaymentRefs(id: string, refs: { txRef?: string; txId?: string }): Promise<void> {
    const j = this.m.get(id);
    if (!j) return;
    if (refs.txRef !== undefined) j.flwTxRef = refs.txRef;
    if (refs.txId !== undefined) j.flwTxId = refs.txId;
  }
  async setPayoutState(id: string, state: { pending: boolean; error?: string | null; ref?: string | null }): Promise<void> {
    const j = this.m.get(id);
    if (!j) return;
    j.payoutPending = state.pending;
    if (state.error !== undefined) { if (state.error === null) delete j.payoutError; else j.payoutError = state.error; }
    if (state.ref !== undefined) { if (state.ref === null) delete j.payoutRef; else j.payoutRef = state.ref; }
  }
  async listPayoutPending(limit: number): Promise<Job[]> {
    return [...this.m.values()].filter((j) => j.payoutPending).slice(0, limit);
  }
  async claim(id: string, riderId: string): Promise<boolean> {
    const j = this.m.get(id);
    if (!j || j.status !== 'SEARCHING') return false; // first-accept-wins (atomic in a single-threaded map)
    j.status = 'ACCEPTED';
    j.riderId = riderId;
    return true;
  }
  async release(id: string): Promise<void> {
    const j = this.m.get(id);
    if (!j) return;
    j.status = 'SEARCHING';
    delete j.riderId;
  }
}
