import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { DocumentRecord, DocumentRepo, NewDocument } from '../ports.js';
import type { VehicleTrack } from '../domain/document-catalog.js';

/** DEV/tests: rider documents + chosen track held in memory. Prisma adapter arrives with the DB phase. */
@Injectable()
export class InMemoryDocumentRepo implements DocumentRepo {
  private byId = new Map<string, DocumentRecord>();
  private trackByRider = new Map<string, VehicleTrack>();

  async add(doc: NewDocument): Promise<DocumentRecord> {
    const record: DocumentRecord = { id: randomUUID(), createdAt: Date.now(), ...doc };
    this.byId.set(record.id, record);
    return record;
  }
  async findById(id: string): Promise<DocumentRecord | null> {
    return this.byId.get(id) ?? null;
  }
  async listByRider(riderId: string): Promise<DocumentRecord[]> {
    return [...this.byId.values()].filter((d) => d.riderId === riderId).sort((a, b) => a.createdAt - b.createdAt);
  }
  async updateStatus(
    id: string,
    patch: Partial<Pick<DocumentRecord, 'status' | 'rejectionReason' | 'reviewedBy' | 'reviewedAt'>>,
  ): Promise<DocumentRecord | null> {
    const existing = this.byId.get(id);
    if (!existing) return null;
    const next = { ...existing, ...patch };
    this.byId.set(id, next);
    return next;
  }
  async setTrack(riderId: string, track: VehicleTrack): Promise<void> {
    this.trackByRider.set(riderId, track);
  }
  async getTrack(riderId: string): Promise<VehicleTrack | null> {
    return this.trackByRider.get(riderId) ?? null;
  }
  async listRiderIds(): Promise<string[]> {
    const ids = new Set<string>(this.trackByRider.keys());
    for (const d of this.byId.values()) ids.add(d.riderId);
    return [...ids];
  }
}
