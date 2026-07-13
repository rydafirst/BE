import { Module } from '@nestjs/common';
import { RatingsService } from './ratings.service.js';
import { RATING_REPO } from './ports.js';
import { InMemoryRatingRepo } from './adapters/in-memory-rating.repo.js';
import { PrismaRatingRepo } from './adapters/prisma-rating.repo.js';

const usePg = process.env.DB_DRIVER === 'postgres';

@Module({
  providers: [
    RatingsService,
    { provide: RATING_REPO, useClass: usePg ? PrismaRatingRepo : InMemoryRatingRepo },
  ],
  exports: [RatingsService],
})
export class RatingsModule {}
