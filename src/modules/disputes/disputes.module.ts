import { Module } from '@nestjs/common';
import { JobsModule } from '../jobs/jobs.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { DisputeService } from './dispute.service.js';
import { DisputeController } from './dispute.controller.js';
import { DISPUTE_REPO } from './ports.js';
import { InMemoryDisputeRepo } from './adapters/in-memory-dispute.repo.js';
import { PrismaDisputeRepo } from './adapters/prisma-dispute.repo.js';

const usePg = process.env.DB_DRIVER === 'postgres';


@Module({
  imports: [JobsModule, IdentityModule],
  controllers: [DisputeController],
  providers: [DisputeService, { provide: DISPUTE_REPO, useClass: usePg ? PrismaDisputeRepo : InMemoryDisputeRepo }],
})
export class DisputesModule {}
