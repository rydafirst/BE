import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { HmacHasher } from '../../common/security/hmac-hasher.js';
import { OTP_REPO, REFRESH_REPO, USER_REPO, RATE_LIMITER, TOKEN_SIGNER, OTP_SENDER } from './ports.js';
import {
  InMemoryOtpRepo, InMemoryRefreshRepo, InMemoryUserRepo,
  InMemoryRateLimiter, DevTokenSigner, DevOtpSender,
} from './adapters/in-memory.adapters.js';
import { PrismaOtpRepo, PrismaRefreshRepo, PrismaUserRepo } from './adapters/prisma.adapters.js';
import { RedisRateLimiter } from './adapters/redis-rate-limiter.js';

const usePg = process.env.DB_DRIVER === 'postgres';


@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    HmacHasher,
    { provide: OTP_REPO, useClass: usePg ? PrismaOtpRepo : InMemoryOtpRepo },
    { provide: REFRESH_REPO, useClass: usePg ? PrismaRefreshRepo : InMemoryRefreshRepo },
    { provide: USER_REPO, useClass: usePg ? PrismaUserRepo : InMemoryUserRepo },
    { provide: RATE_LIMITER, useClass: usePg ? RedisRateLimiter : InMemoryRateLimiter },
    { provide: TOKEN_SIGNER, useClass: DevTokenSigner },
    { provide: OTP_SENDER, useClass: DevOtpSender },
  ],
})
export class AuthModule {}
