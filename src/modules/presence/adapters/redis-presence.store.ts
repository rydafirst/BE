import { Injectable } from '@nestjs/common';
import { RedisService } from '../../../database/redis.service.js';
import type { PresenceStore } from '../ports.js';

// Presence in Redis. A generous TTL means a rider auto-goes-offline if the app disappears without
// a clean toggle; each explicit "online" refreshes it. Prevents stale "online forever" riders.
const ONLINE_TTL_SECONDS = 24 * 60 * 60;

@Injectable()
export class RedisPresenceStore implements PresenceStore {
  constructor(private readonly redis: RedisService) {}
  private key(riderId: string): string { return `presence:${riderId}`; }

  async isOnline(riderId: string): Promise<boolean> {
    return (await this.redis.get(this.key(riderId))) === '1';
  }
  async setOnline(riderId: string, online: boolean): Promise<void> {
    if (online) await this.redis.set(this.key(riderId), '1', 'EX', ONLINE_TTL_SECONDS);
    else await this.redis.del(this.key(riderId));
  }
}
