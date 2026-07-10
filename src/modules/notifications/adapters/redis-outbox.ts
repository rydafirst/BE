import { Injectable } from '@nestjs/common';
import { RedisService } from '../../../database/redis.service.js';
import type { NotificationOutbox } from '../ports.js';

const TTL_SECONDS = 7 * 24 * 3600; // remember sent stages for a week

@Injectable()
export class RedisOutbox implements NotificationOutbox {
  constructor(private readonly redis: RedisService) {}
  async seen(key: string): Promise<boolean> {
    return (await this.redis.exists(`ob:${key}`)) === 1;
  }
  async mark(key: string): Promise<void> {
    await this.redis.set(`ob:${key}`, '1', 'EX', TTL_SECONDS);
  }
}
