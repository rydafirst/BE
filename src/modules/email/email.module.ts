import { Global, Module } from '@nestjs/common';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.validation.js';
import { EMAIL_SENDER } from './email.port.js';
import { ResendEmailSender } from './resend.sender.js';
import { ConsoleEmailSender } from './console.sender.js';

/**
 * Global email module. Uses Resend when RESEND_API_KEY is present, otherwise a console fallback
 * (so dev and CI never need a key). Inject EMAIL_SENDER anywhere to send transactional email.
 */
@Global()
@Module({
  providers: [
    {
      provide: EMAIL_SENDER,
      useFactory: (env: Env) => (env.RESEND_API_KEY ? new ResendEmailSender(env) : new ConsoleEmailSender()),
      inject: [ENV],
    },
  ],
  exports: [EMAIL_SENDER],
})
export class EmailModule {}
