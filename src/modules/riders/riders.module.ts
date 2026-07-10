import { Module } from '@nestjs/common';
import { RiderKycService } from './rider-kyc.service.js';
import { KYC_REPO } from './kyc.ports.js';
import { InMemoryKycRepo } from './adapters/in-memory-kyc.repo.js';
import { PrismaKycRepo } from './adapters/prisma-kyc.repo.js';

const usePg = process.env.DB_DRIVER === 'postgres';

import { RidersController } from './riders.controller.js';

@Module({
  controllers: [RidersController],
  providers: [RiderKycService, { provide: KYC_REPO, useClass: usePg ? PrismaKycRepo : InMemoryKycRepo }],
  exports: [RiderKycService],
})
export class RidersModule {}
