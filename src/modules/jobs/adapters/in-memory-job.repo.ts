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
  async listByRider(riderId: string): Promise<Job[]> {
    return [...this.m.values()].filter((j) => j.riderId === riderId);
  }
  async findByTxRef(txRef: string): Promise<Job | null> {
    return [...this.m.values()].find((j) => j.flwTxRef === txRef) ?? null;
  }
  async setArrivedAt(id: string, atMs: number): Promise<void> {
    const j = this.m.get(id); if (j) j.arrivedAt = atMs;
  }
  async setPaymentRefs(id: string, refs: { txRef?: string; txId?: string }): Promise<void> {
    const j = this.m.get(id);
    if (!j) return;
    if (refs.txRef !== undefined) j.flwTxRef = refs.txRef;
    if (refs.txId !== undefined) j.flwTxId = refs.txId;
  }
  async claim(id: string, riderId: string): Promise<boolean> {
    const j = this.m.get(id);
    if (!j || j.status !== 'SEARCHING') return false; // first-accept-wins (atomic in a single-threaded map)
    j.status = 'ACCEPTED';
    j.riderId = riderId;
    return true;
  }
}
