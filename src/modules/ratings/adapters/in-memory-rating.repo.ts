import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NewRating, Rating, RatingRepo } from '../ports.js';

/** DEV/tests: ratings held in memory. One per job (enforced by the service). */
@Injectable()
export class InMemoryRatingRepo implements RatingRepo {
  private byId = new Map<string, Rating>();

  async add(r: NewRating): Promise<Rating> {
    const rating: Rating = { id: randomUUID(), createdAt: Date.now(), ...r };
    this.byId.set(rating.id, rating);
    return rating;
  }
  async findByJob(jobId: string): Promise<Rating | null> {
    for (const r of this.byId.values()) if (r.jobId === jobId) return r;
    return null;
  }
  async listStarsByRider(riderId: string): Promise<number[]> {
    return [...this.byId.values()].filter((r) => r.riderId === riderId).map((r) => r.stars);
  }
}
