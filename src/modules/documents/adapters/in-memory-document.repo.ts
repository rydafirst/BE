import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { DocumentRecord, DocumentRepo, NewDocument, RiderProfile } from '../ports.js';
import type { VehicleTrack } from '../domain/document-catalog.js';

/** DEV/tests: rider documents + onboarding profile held in memory. */
@Injectable()
export class InMemoryDocumentRepo implements DocumentRepo {
  private byId = new Map<string, DocumentRecord>();
  private profileByRider = new Map<string, RiderProfile>();

  private ensureProfile(riderId: string): RiderProfile {
    let p = this.profileByRider.get(riderId);
    if (!p) { p = { track: null, nameVerified: false }; this.profileByRider.set(riderId, p); }
    return p;
  }

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
    this.ensureProfile(riderId).track = track;
  }
  async getTrack(riderId: string): Promise<VehicleTrack | null> {
    return this.profileByRider.get(riderId)?.track ?? null;
  }
  async listRiderIds(): Promise<string[]> {
    const ids = new Set<string>(this.profileByRider.keys());
    for (const d of this.byId.values()) ids.add(d.riderId);
    return [...ids];
  }
  async getProfile(riderId: string): Promise<RiderProfile> {
    return this.profileByRider.get(riderId) ?? { track: null, nameVerified: false };
  }
  async setProfile(riderId: string, patch: { legalName?: string; vehiclePlate?: string; vehicleColor?: string }): Promise<void> {
    const p = this.ensureProfile(riderId);
    if (patch.legalName !== undefined) { p.legalName = patch.legalName; p.nameVerified = false; } // re-verify on change
    if (patch.vehiclePlate !== undefined) p.vehiclePlate = patch.vehiclePlate;
    if (patch.vehicleColor !== undefined) p.vehicleColor = patch.vehicleColor;
  }
  async setNameVerified(riderId: string, verified: boolean): Promise<void> {
    this.ensureProfile(riderId).nameVerified = verified;
  }
}
