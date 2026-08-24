import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { SupportService } from './support.service.js';
import { SupportController } from './support.controller.js';
import { SUPPORT_REPO } from './ports.js';
import { InMemorySupportRepo } from './adapters/in-memory-support.repo.js';
import { PrismaSupportRepo } from './adapters/prisma-support.repo.js';

const usePg = process.env.DB_DRIVER === 'postgres';

@Module({
  imports: [NotificationsModule],
  controllers: [SupportController],
  providers: [
    SupportService,
    { provide: SUPPORT_REPO, useClass: usePg ? PrismaSupportRepo : InMemorySupportRepo },
  ],
  exports: [SupportService],
})
export class SupportModule {}
