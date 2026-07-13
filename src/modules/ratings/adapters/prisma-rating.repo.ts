import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service.js';
import type { NewRating, Rating, RatingRepo } from '../ports.js';

interface Row {
  id: string; jobId: string; riderId: string; customerId: string;
  stars: number; comment: string | null; createdAt: Date;
}
function toRating(r: Row): Rating {
  return {
    id: r.id, jobId: r.jobId, riderId: r.riderId, customerId: r.customerId,
    stars: r.stars, createdAt: r.createdAt.getTime(),
    ...(r.comment ? { comment: r.comment } : {}),
  };
}

/** Postgres-backed ratings (persistent, one row per job). */
@Injectable()
export class PrismaRatingRepo implements RatingRepo {
  constructor(private readonly db: PrismaService) {}

  async add(r: NewRating): Promise<Rating> {
    const row = await this.db.rating.create({
      data: { jobId: r.jobId, riderId: r.riderId, customerId: r.customerId, stars: r.stars, comment: r.comment ?? null },
    });
    return toRating(row as Row);
  }
  async findByJob(jobId: string): Promise<Rating | null> {
    const row = await this.db.rating.findUnique({ where: { jobId } });
    return row ? toRating(row as Row) : null;
  }
  async listStarsByRider(riderId: string): Promise<number[]> {
    const rows = await this.db.rating.findMany({ where: { riderId }, select: { stars: true } });
    return (rows as { stars: number }[]).map((r) => r.stars);
  }
}
