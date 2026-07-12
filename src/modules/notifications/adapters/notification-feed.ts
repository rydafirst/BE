import { Injectable } from '@nestjs/common';
import { RedisService } from '../../../database/redis.service.js';
import type { NotificationFeed, NotificationItem } from '../ports.js';

const MAX_PER_USER = 100;

/** DEV: per-user in-app notification feed held in memory. */
@Injectable()
export class InMemoryNotificationFeed implements NotificationFeed {
  private byUser = new Map<string, NotificationItem[]>();
  async append(userId: string, item: NotificationItem): Promise<void> {
    const list = this.byUser.get(userId) ?? [];
    list.unshift(item);
    this.byUser.set(userId, list.slice(0, MAX_PER_USER));
  }
  async list(userId: string, limit: number): Promise<NotificationItem[]> {
    return (this.byUser.get(userId) ?? []).slice(0, limit);
  }
  async markAllRead(userId: string): Promise<void> {
    for (const i of this.byUser.get(userId) ?? []) i.read = true;
  }
  async unreadCount(userId: string): Promise<number> {
    return (this.byUser.get(userId) ?? []).filter((i) => !i.read).length;
  }
}

/** Redis-backed feed: one JSON list per user (bounded), rewritten on mutation. */
@Injectable()
export class RedisNotificationFeed implements NotificationFeed {
  constructor(private readonly redis: RedisService) {}
  private key(userId: string): string { return `notif:${userId}`; }
  private async read(userId: string): Promise<NotificationItem[]> {
    const s = await this.redis.get(this.key(userId));
    return s ? (JSON.parse(s) as NotificationItem[]) : [];
  }
  private async write(userId: string, items: NotificationItem[]): Promise<void> {
    await this.redis.set(this.key(userId), JSON.stringify(items.slice(0, MAX_PER_USER)));
  }
  async append(userId: string, item: NotificationItem): Promise<void> {
    const list = await this.read(userId);
    list.unshift(item);
    await this.write(userId, list);
  }
  async list(userId: string, limit: number): Promise<NotificationItem[]> {
    return (await this.read(userId)).slice(0, limit);
  }
  async markAllRead(userId: string): Promise<void> {
    const list = await this.read(userId);
    for (const i of list) i.read = true;
    await this.write(userId, list);
  }
  async unreadCount(userId: string): Promise<number> {
    return (await this.read(userId)).filter((i) => !i.read).length;
  }
}
