import { Injectable } from '@nestjs/common';
import { RedisService } from '../../../database/redis.service.js';
import type { LastKnown, LocationStore } from '../ports.js';

const TTL_SECONDS = 30; // raw last-known is ephemeral (privacy + freshness)

@Injectable()
export class RedisLocationStore implements LocationStore {
  constructor(private readonly redis: RedisService) {}
  private key(jobId: string): string { return `loc:${jobId}`; }
  async get(jobId: string): Promise<LastKnown | null> {
    const v = await this.redis.get(this.key(jobId));
    return v ? (JSON.parse(v) as LastKnown) : null;
  }
  async set(jobId: string, value: LastKnown): Promise<void> {
    await this.redis.set(this.key(jobId), JSON.stringify(value), 'EX', TTL_SECONDS);
  }
}
