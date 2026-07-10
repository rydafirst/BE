import { Module } from '@nestjs/common';
import { JobsModule } from '../jobs/jobs.module.js';
import { TrackingService } from './tracking.service.js';
import { TrackingGateway } from './tracking.gateway.js';
import { LOCATION_STORE } from './ports.js';
import { InMemoryLocationStore } from './adapters/in-memory-location.store.js';
import { RedisLocationStore } from './adapters/redis-location.store.js';

const usePg = process.env.DB_DRIVER === 'postgres';


@Module({
  imports: [JobsModule],
  providers: [
    TrackingService,
    TrackingGateway,
    { provide: LOCATION_STORE, useClass: usePg ? RedisLocationStore : InMemoryLocationStore },
  ],
  exports: [TrackingService],
})
export class TrackingModule {}
