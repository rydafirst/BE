import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.validation.js';

@Injectable()
export class RedisService extends Redis implements OnModuleDestroy {
  constructor(@Inject(ENV) env: Env) {
    super(env.REDIS_URL, { maxRetriesPerRequest: 3, lazyConnect: false });
  }
  async onModuleDestroy(): Promise<void> { await this.quit(); }
}
