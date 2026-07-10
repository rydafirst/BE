import { Module } from '@nestjs/common';
import { JobsModule } from '../jobs/jobs.module.js';
import { HmacHasher } from '../../common/security/hmac-hasher.js';
import { ConfirmationService } from './confirmation.service.js';
import { ConfirmationController } from './confirmation.controller.js';
import { CODE_REPO } from './ports.js';
import { InMemoryCodeRepo } from './adapters/in-memory-code.repo.js';
import { PrismaCodeRepo } from './adapters/prisma-code.repo.js';

const usePg = process.env.DB_DRIVER === 'postgres';


@Module({
  imports: [JobsModule],
  controllers: [ConfirmationController],
  providers: [ConfirmationService, HmacHasher, { provide: CODE_REPO, useClass: usePg ? PrismaCodeRepo : InMemoryCodeRepo }],
})
export class ConfirmationsModule {}
