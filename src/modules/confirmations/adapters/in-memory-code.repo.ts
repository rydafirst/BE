import { Injectable } from '@nestjs/common';
import type { CodeKind, CodeRecord } from '../domain/confirmation-code.js';
import type { ConfirmationCodeRepository } from '../ports.js';

// DEV ONLY. Replace with Postgres (hashed codes, per job+kind) in the persistence phase.
@Injectable()
export class InMemoryCodeRepo implements ConfirmationCodeRepository {
  private m = new Map<string, CodeRecord>();
  private key(jobId: string, kind: CodeKind): string { return `${jobId}:${kind}`; }
  async save(jobId: string, r: CodeRecord): Promise<void> { this.m.set(this.key(jobId, r.kind), r); }
  async find(jobId: string, kind: CodeKind): Promise<CodeRecord | null> { return this.m.get(this.key(jobId, kind)) ?? null; }
  async incrementAttempts(jobId: string, kind: CodeKind): Promise<void> {
    const r = this.m.get(this.key(jobId, kind)); if (r) r.attempts += 1;
  }
  async markConsumed(jobId: string, kind: CodeKind): Promise<void> {
    const r = this.m.get(this.key(jobId, kind)); if (r) r.consumed = true;
  }
}
