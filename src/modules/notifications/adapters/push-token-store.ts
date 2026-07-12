import { Injectable } from '@nestjs/common';
import { RedisService } from '../../../database/redis.service.js';
import type { PushToken, PushTokenStore } from '../ports.js';

const MAX_DEVICES_PER_USER = 10; // bound per-user growth; oldest tokens drop off

// De-duplicate by token string, keep newest-last, and cap the list.
function upsert(list: PushToken[], token: PushToken): PushToken[] {
  const next = list.filter((t) => t.token !== token.token);
  next.push(token);
  return next.slice(-MAX_DEVICES_PER_USER);
}

/** DEV: per-user device push tokens held in memory. */
@Injectable()
export class InMemoryPushTokenStore implements PushTokenStore {
  private byUser = new Map<string, PushToken[]>();
  async save(userId: string, token: PushToken): Promise<void> {
    this.byUser.set(userId, upsert(this.byUser.get(userId) ?? [], token));
  }
  async remove(userId: string, token: string): Promise<void> {
    this.byUser.set(userId, (this.byUser.get(userId) ?? []).filter((t) => t.token !== token));
  }
  async listForUser(userId: string): Promise<PushToken[]> {
    return this.byUser.get(userId) ?? [];
  }
}

/** Redis-backed store: one JSON list of device tokens per user. */
@Injectable()
export class RedisPushTokenStore implements PushTokenStore {
  constructor(private readonly redis: RedisService) {}
  private key(userId: string): string { return `pushtok:${userId}`; }
  private async read(userId: string): Promise<PushToken[]> {
    const s = await this.redis.get(this.key(userId));
    return s ? (JSON.parse(s) as PushToken[]) : [];
  }
  private async write(userId: string, list: PushToken[]): Promise<void> {
    await this.redis.set(this.key(userId), JSON.stringify(list));
  }
  async save(userId: string, token: PushToken): Promise<void> {
    await this.write(userId, upsert(await this.read(userId), token));
  }
  async remove(userId: string, token: string): Promise<void> {
    await this.write(userId, (await this.read(userId)).filter((t) => t.token !== token));
  }
  async listForUser(userId: string): Promise<PushToken[]> {
    return this.read(userId);
  }
}
