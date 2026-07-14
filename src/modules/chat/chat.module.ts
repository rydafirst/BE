import { Module } from '@nestjs/common';
import { JobsModule } from '../jobs/jobs.module.js';
import { ChatService } from './chat.service.js';
import { ChatController } from './chat.controller.js';
import { MESSAGE_REPO } from './ports.js';
import { InMemoryMessageRepo } from './adapters/in-memory-message.repo.js';
import { PrismaMessageRepo } from './adapters/prisma-message.repo.js';

const usePg = process.env.DB_DRIVER === 'postgres';

@Module({
  imports: [JobsModule],
  controllers: [ChatController],
  providers: [
    ChatService,
    { provide: MESSAGE_REPO, useClass: usePg ? PrismaMessageRepo : InMemoryMessageRepo },
  ],
  exports: [ChatService],
})
export class ChatModule {}
