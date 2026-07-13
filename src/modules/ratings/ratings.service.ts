import { Inject, Injectable } from '@nestjs/common';
import { averageRating, cleanComment } from './domain/rating.js';
import { RATING_REPO, type NewRating, type Rating, type RatingRepo } from './ports.js';

@Injectable()
export class RatingsService {
  constructor(@Inject(RATING_REPO) private readonly repo: RatingRepo) {}

  record(r: NewRating): Promise<Rating> {
    return this.repo.add({ ...r, ...(cleanComment(r.comment) ? { comment: cleanComment(r.comment) } : {}) });
  }

  async hasRatingForJob(jobId: string): Promise<boolean> {
    return (await this.repo.findByJob(jobId)) !== null;
  }

  async averageForRider(riderId: string): Promise<{ average: number; count: number }> {
    return averageRating(await this.repo.listStarsByRider(riderId));
  }
}
