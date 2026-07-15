import { Module } from '@nestjs/common';
import { JobsModule } from '../jobs/jobs.module.js';
import { ChatService } from './chat.service.js';
import { ChatController } from './chat.controller.js';
import { MESSAGE_REPO, REPORT_REPO } from './ports.js';
import { InMemoryMessageRepo, InMemoryReportRepo } from './adapters/in-memory-message.repo.js';
import { PrismaMessageRepo, PrismaReportRepo } from './adapters/prisma-message.repo.js';

const usePg = process.env.DB_DRIVER === 'postgres';

@Module({
  imports: [JobsModule],
  controllers: [ChatController],
  providers: [
    ChatService,
    { provide: MESSAGE_REPO, useClass: usePg ? PrismaMessageRepo : InMemoryMessageRepo },
    { provide: REPORT_REPO, useClass: usePg ? PrismaReportRepo : InMemoryReportRepo },
  ],
  exports: [ChatService],
})
export class ChatModule {}
