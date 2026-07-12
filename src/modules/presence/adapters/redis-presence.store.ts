import { Injectable } from '@nestjs/common';
import { RedisService } from '../../../database/redis.service.js';
import type { PresenceStore } from '../ports.js';

// Presence in Redis. A generous TTL means a rider auto-goes-offline if the app disappears without
// a clean toggle; each explicit "online" refreshes it. Prevents stale "online forever" riders.
const ONLINE_TTL_SECONDS = 24 * 60 * 60;
// An index set of online riders so we can broadcast new jobs without scanning the keyspace.
const ONLINE_SET = 'presence:online';

@Injectable()
export class RedisPresenceStore implements PresenceStore {
  constructor(private readonly redis: RedisService) {}
  private key(riderId: string): string { return `presence:${riderId}`; }

  async isOnline(riderId: string): Promise<boolean> {
    return (await this.redis.get(this.key(riderId))) === '1';
  }
  async setOnline(riderId: string, online: boolean): Promise<void> {
    if (online) {
      await this.redis.set(this.key(riderId), '1', 'EX', ONLINE_TTL_SECONDS);
      await this.redis.sadd(ONLINE_SET, riderId);
    } else {
      await this.redis.del(this.key(riderId));
      await this.redis.srem(ONLINE_SET, riderId);
    }
  }
  async listOnline(): Promise<string[]> {
    const members = await this.redis.smembers(ONLINE_SET);
    if (members.length === 0) return [];
    // The per-rider key has a TTL; the index set does not. Drop any members whose key has expired
    // so a rider whose app vanished without a clean toggle can't linger as "online forever".
    const live = await Promise.all(members.map((id) => this.isOnline(id)));
    const online: string[] = [];
    const stale: string[] = [];
    members.forEach((id, i) => (live[i] ? online.push(id) : stale.push(id)));
    if (stale.length) await this.redis.srem(ONLINE_SET, ...stale);
    return online;
  }
}
