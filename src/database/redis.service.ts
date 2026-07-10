import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.validation.js';

@Injectable()
export class RedisService extends Redis implements OnModuleDestroy {
  constructor(@Inject(ENV) env: Env) {
    // RedisService is only instantiated when DB_DRIVER=postgres, where env validation
    // guarantees REDIS_URL is present (see env.validation.ts superRefine).
    super(env.REDIS_URL as string, { maxRetriesPerRequest: 3, lazyConnect: false });
  }
  async onModuleDestroy(): Promise<void> { await this.quit(); }
}
