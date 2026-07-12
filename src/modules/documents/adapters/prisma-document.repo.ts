import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service.js';
import type { DocumentStatus, DocumentType, VehicleTrack } from '../domain/document-catalog.js';
import type { DocumentRecord, DocumentRepo, NewDocument } from '../ports.js';

// Row shape returned by Prisma for a RiderDocument (BigInt epoch-ms fields).
interface Row {
  id: string; riderId: string; track: string; type: string; fileKey: string; status: string;
  rejectionReason: string | null; issuedAt: bigint | null; expiresAt: bigint | null;
  version: number; reviewedBy: string | null; reviewedAt: bigint | null; createdAt: Date;
}

function toRecord(r: Row): DocumentRecord {
  return {
    id: r.id, riderId: r.riderId, track: r.track as VehicleTrack, type: r.type as DocumentType,
    fileKey: r.fileKey, status: r.status as DocumentStatus, version: r.version,
    createdAt: r.createdAt.getTime(),
    ...(r.rejectionReason ? { rejectionReason: r.rejectionReason } : {}),
    ...(r.issuedAt !== null ? { issuedAt: Number(r.issuedAt) } : {}),
    ...(r.expiresAt !== null ? { expiresAt: Number(r.expiresAt) } : {}),
    ...(r.reviewedBy ? { reviewedBy: r.reviewedBy } : {}),
    ...(r.reviewedAt !== null ? { reviewedAt: Number(r.reviewedAt) } : {}),
  };
}

/** Postgres-backed document + track store — the production adapter (persistent, shared across instances). */
@Injectable()
export class PrismaDocumentRepo implements DocumentRepo {
  constructor(private readonly db: PrismaService) {}

  async add(doc: NewDocument): Promise<DocumentRecord> {
    const r = await this.db.riderDocument.create({
      data: {
        riderId: doc.riderId, track: doc.track, type: doc.type, fileKey: doc.fileKey,
        status: doc.status, version: doc.version,
        issuedAt: doc.issuedAt !== undefined ? BigInt(doc.issuedAt) : null,
        expiresAt: doc.expiresAt !== undefined ? BigInt(doc.expiresAt) : null,
      },
    });
    return toRecord(r as Row);
  }

  async findById(id: string): Promise<DocumentRecord | null> {
    const r = await this.db.riderDocument.findUnique({ where: { id } });
    return r ? toRecord(r as Row) : null;
  }

  async listByRider(riderId: string): Promise<DocumentRecord[]> {
    const rows = await this.db.riderDocument.findMany({ where: { riderId }, orderBy: { createdAt: 'asc' } });
    return (rows as Row[]).map((r: Row) => toRecord(r));
  }

  async updateStatus(
    id: string,
    patch: Partial<Pick<DocumentRecord, 'status' | 'rejectionReason' | 'reviewedBy' | 'reviewedAt'>>,
  ): Promise<DocumentRecord | null> {
    const existing = await this.db.riderDocument.findUnique({ where: { id } });
    if (!existing) return null;
    const r = await this.db.riderDocument.update({
      where: { id },
      data: {
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.rejectionReason !== undefined ? { rejectionReason: patch.rejectionReason } : {}),
        ...(patch.reviewedBy !== undefined ? { reviewedBy: patch.reviewedBy } : {}),
        ...(patch.reviewedAt !== undefined ? { reviewedAt: BigInt(patch.reviewedAt) } : {}),
      },
    });
    return toRecord(r as Row);
  }

  async setTrack(riderId: string, track: VehicleTrack): Promise<void> {
    await this.db.riderOnboarding.upsert({
      where: { riderId },
      create: { riderId, track },
      update: { track },
    });
  }

  async getTrack(riderId: string): Promise<VehicleTrack | null> {
    const r = await this.db.riderOnboarding.findUnique({ where: { riderId } });
    return r ? (r.track as VehicleTrack) : null;
  }

  async listRiderIds(): Promise<string[]> {
    const [tracks, docs] = await Promise.all([
      this.db.riderOnboarding.findMany({ select: { riderId: true } }),
      this.db.riderDocument.findMany({ select: { riderId: true }, distinct: ['riderId'] }),
    ]);
    return [...new Set([
      ...(tracks as { riderId: string }[]).map((t) => t.riderId),
      ...(docs as { riderId: string }[]).map((d) => d.riderId),
    ])];
  }
}
