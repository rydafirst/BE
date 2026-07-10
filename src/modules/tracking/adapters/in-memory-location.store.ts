import { Injectable } from '@nestjs/common';
import type { LastKnown, LocationStore } from '../ports.js';

// DEV ONLY. Replace with Redis (geo set + TTL) in the persistence phase.
@Injectable()
export class InMemoryLocationStore implements LocationStore {
  private m = new Map<string, LastKnown>();
  async get(jobId: string): Promise<LastKnown | null> { return this.m.get(jobId) ?? null; }
  async set(jobId: string, value: LastKnown): Promise<void> { this.m.set(jobId, value); }
}
