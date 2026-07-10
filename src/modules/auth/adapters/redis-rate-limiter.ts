import { Injectable } from '@nestjs/common';
import { RedisService } from '../../../database/redis.service.js';
import type { RateLimiter } from '../ports.js';

@Injectable()
export class RedisRateLimiter implements RateLimiter {
  constructor(private readonly redis: RedisService) {}
  /** Fixed-window counter: INCR the key, set TTL on first hit, allow while <= limit. */
  async hit(key: string, limit: number, windowSeconds: number): Promise<boolean> {
    const k = `rl:${key}`;
    const n = await this.redis.incr(k);
    if (n === 1) await this.redis.expire(k, windowSeconds);
    return n <= limit;
  }
}
