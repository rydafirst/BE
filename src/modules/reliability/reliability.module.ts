import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { ReliabilityService } from './reliability.service.js';
import { ReliabilityAdminController } from './reliability-admin.controller.js';
import { RELIABILITY_REPO } from './ports.js';
import { TRAFFIC_PROVIDER } from './traffic.port.js';
import { InMemoryReliabilityRepo } from './adapters/in-memory-reliability.repo.js';
import { PrismaReliabilityRepo } from './adapters/prisma-reliability.repo.js';
import { GoogleTrafficProvider } from './adapters/google-traffic.provider.js';

const usePg = process.env.DB_DRIVER === 'postgres';

@Module({
  imports: [NotificationsModule, SettingsModule],
  controllers: [ReliabilityAdminController],
  providers: [
    ReliabilityService,
    { provide: RELIABILITY_REPO, useClass: usePg ? PrismaReliabilityRepo : InMemoryReliabilityRepo },
    // Traffic-aware ETA via Google Routes (reuses GOOGLE_MAPS_API_KEY). Self-disables to null when the
    // key/API isn't set up, so lateness cases fall back to admin review instead of auto-striking.
    { provide: TRAFFIC_PROVIDER, useClass: GoogleTrafficProvider },
  ],
  exports: [ReliabilityService],
})
export class ReliabilityModule {}
