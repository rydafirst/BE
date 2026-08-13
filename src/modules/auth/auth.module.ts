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
import { TermiiOtpSender } from './adapters/termii-otp-sender.js';
import { AfricasTalkingOtpSender } from './adapters/africas-talking-otp-sender.js';
import { UserCustomerEmail } from './adapters/user-customer-email.js';
import { CUSTOMER_EMAIL } from '../jobs/customer-email.port.js';
import { DirectContactChannel } from './adapters/direct-contact-channel.js';
import { CONTACT_CHANNEL } from '../jobs/contact-channel.port.js';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.validation.js';

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
    {
      // OTP delivery: real SMS when OTP_CHANNEL=sms (Termii or Africa's Talking per SMS_PROVIDER),
      // else the dev console sender. Email delivery is handled separately in AuthService.
      provide: OTP_SENDER,
      useFactory: (env: Env) => {
        if (env.OTP_CHANNEL !== 'sms') return new DevOtpSender();
        return env.SMS_PROVIDER === 'africastalking'
          ? new AfricasTalkingOtpSender(env)
          : new TermiiOtpSender(env);
      },
      inject: [ENV],
    },
    // Customer email lookup for payment receipts, shared with the jobs module.
    { provide: CUSTOMER_EMAIL, useClass: UserCustomerEmail },
    // Phone lookup so the two parties of a live job can call each other. Swap for a proxy-number
    // adapter to stop handing out real numbers — nothing outside this line needs to change.
    { provide: CONTACT_CHANNEL, useClass: DirectContactChannel },
  ],
  exports: [CUSTOMER_EMAIL, CONTACT_CHANNEL, USER_REPO, REFRESH_REPO],
})
export class AuthModule {}
