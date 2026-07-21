import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { isDeliveryComplete } from './domain/job-state-machine.js';
import { isValidStars } from '../ratings/domain/rating.js';
import { RatingsService } from '../ratings/ratings.service.js';
import { DocumentsService } from '../documents/documents.service.js';
import { JOB_REPO, type JobRepository } from './ports.js';
import type { Rating } from '../ratings/ports.js';

export interface PendingRating {
  jobId: string; amountMinor: number; createdAt: string; dropoffArea?: string; riderName?: string;
}

/**
 * Rating a finished delivery.
 *
 * Split out of JobsService: rating happens strictly AFTER the lifecycle has ended, so it shares none
 * of the state machine's invariants. It reads a finished job and writes to a different store.
 */
@Injectable()
export class JobRatingsService {
  constructor(
    @Inject(JOB_REPO) private readonly jobs: JobRepository,
    private readonly ratings: RatingsService,
    private readonly documents: DocumentsService,
  ) {}

  /** Customer rates their rider. One rating per job; fail-closed on every precondition. */
  async rateJob(customerId: string, jobId: string, input: { stars: number; comment?: string }): Promise<Rating> {
    if (!isValidStars(input.stars)) throw new BadRequestException('Rating must be from 1 to 5 stars');
    const job = await this.jobs.find(jobId);
    if (!job) throw new NotFoundException('Job not found');
    if (job.customerId !== customerId) throw new ForbiddenException();
    // Shares the domain predicate with the rest of the app, so "finished" cannot drift between here
    // and the Activity views or the idempotent confirm path.
    if (!isDeliveryComplete(job.status)) throw new ConflictException('You can only rate a completed delivery');
    if (!job.riderId) throw new ConflictException('This delivery had no rider to rate');
    if (await this.ratings.hasRatingForJob(jobId)) throw new ConflictException('You already rated this delivery');
    return this.ratings.record({
      jobId, riderId: job.riderId, customerId, stars: input.stars,
      ...(input.comment ? { comment: input.comment } : {}),
    });
  }

  /** Completed deliveries the customer hasn't rated yet — drives the rating prompt. */
  async pendingRatings(customerId: string): Promise<PendingRating[]> {
    const jobs = await this.jobs.listByCustomer(customerId);
    const done = jobs.filter((j) => isDeliveryComplete(j.status) && j.riderId);
    const out: PendingRating[] = [];
    for (const j of done) {
      if (await this.ratings.hasRatingForJob(j.id)) continue;
      const summary = j.riderId ? await this.documents.riderSummaryFor(j.riderId) : null;
      out.push({
        jobId: j.id, amountMinor: j.amountMinor, createdAt: j.createdAt,
        ...(j.dropoffArea ? { dropoffArea: j.dropoffArea } : {}),
        ...(summary?.name ? { riderName: summary.name } : {}),
      });
    }
    return out;
  }
}
