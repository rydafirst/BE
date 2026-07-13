import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service.js';
import type { DisputeRecord, DisputeRepository } from '../ports.js';

@Injectable()
export class PrismaDisputeRepo implements DisputeRepository {
  constructor(private readonly db: PrismaService) {}
  async create(d: DisputeRecord): Promise<void> {
    await this.db.dispute.create({
      data: {
        id: d.id, jobId: d.jobId, openedBy: d.openedBy, status: d.status, tier: d.tier,
        resolution: d.resolution ?? null, createdAt: new Date(d.createdAt),
        resolvedAt: d.resolvedAt ? new Date(d.resolvedAt) : null,
      },
    });
  }
  async find(id: string): Promise<DisputeRecord | null> {
    const r = await this.db.dispute.findUnique({ where: { id } });
    if (!r) return null;
    return {
      id: r.id, jobId: r.jobId, openedBy: r.openedBy, status: r.status, tier: r.tier as 'auto' | 'manual',
      ...(r.resolution ? { resolution: r.resolution as DisputeRecord['resolution'] } : {}),
      createdAt: r.createdAt.toISOString(), ...(r.resolvedAt ? { resolvedAt: r.resolvedAt.toISOString() } : {}),
    };
  }
  async update(id: string, patch: Partial<DisputeRecord>): Promise<void> {
    await this.db.dispute.update({
      where: { id },
      data: {
        ...(patch.status ? { status: patch.status } : {}),
        ...(patch.resolution ? { resolution: patch.resolution } : {}),
        ...(patch.resolvedAt ? { resolvedAt: new Date(patch.resolvedAt) } : {}),
      },
    });
  }
  async list(): Promise<DisputeRecord[]> {
    const rows = await this.db.dispute.findMany({ orderBy: { createdAt: 'desc' } });
    return (rows as Array<{ id: string; jobId: string; openedBy: string; status: DisputeRecord['status']; tier: string; resolution: string | null; createdAt: Date; resolvedAt: Date | null }>).map((r) => ({
      id: r.id, jobId: r.jobId, openedBy: r.openedBy, status: r.status, tier: r.tier as 'auto' | 'manual',
      ...(r.resolution ? { resolution: r.resolution as DisputeRecord['resolution'] } : {}),
      createdAt: r.createdAt.toISOString(), ...(r.resolvedAt ? { resolvedAt: r.resolvedAt.toISOString() } : {}),
    }));
  }
}
