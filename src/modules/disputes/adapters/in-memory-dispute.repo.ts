import { Injectable } from '@nestjs/common';
import type { DisputeRecord, DisputeRepository } from '../ports.js';

// DEV ONLY. Replace with Postgres (disputes + evidence bundle refs) in the persistence phase.
@Injectable()
export class InMemoryDisputeRepo implements DisputeRepository {
  private m = new Map<string, DisputeRecord>();
  async create(d: DisputeRecord): Promise<void> { this.m.set(d.id, { ...d }); }
  async find(id: string): Promise<DisputeRecord | null> { return this.m.get(id) ?? null; }
  async update(id: string, patch: Partial<DisputeRecord>): Promise<void> {
    const cur = this.m.get(id); if (cur) this.m.set(id, { ...cur, ...patch });
  }
  async list(): Promise<DisputeRecord[]> {
    return [...this.m.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}
