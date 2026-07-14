import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service.js';
import type { IdempotencyRecord } from '../domain/idempotency.js';
import { IDEMPOTENCY_PENDING, type IdempotencyStore, type WebhookInboxStore } from '../ports.js';

@Injectable()
export class PrismaIdempotencyStore implements IdempotencyStore {
  constructor(private readonly db: PrismaService) {}
  async get<T>(key: string): Promise<IdempotencyRecord<T> | null> {
    const r = await this.db.idempotencyRecord.findUnique({ where: { key } });
    return r ? { key, result: r.result as T } : null;
  }
  async put<T>(key: string, result: T): Promise<void> {
    // First write wins: ignore duplicate-key races.
    await this.db.idempotencyRecord.upsert({
      where: { key }, update: {}, create: { key, result: result as object },
    });
  }
  async claim(key: string): Promise<boolean> {
    // The unique key column makes this INSERT the atomic lock: exactly one caller succeeds; a
    // concurrent caller hits a unique-constraint violation (P2002) and loses the race.
    try {
      await this.db.idempotencyRecord.create({ data: { key, result: IDEMPOTENCY_PENDING as object } });
      return true;
    } catch (e) {
      if (e && typeof e === 'object' && (e as { code?: string }).code === 'P2002') return false;
      throw e;
    }
  }
  async complete<T>(key: string, result: T): Promise<void> {
    // Overwrite the pending reservation with the final result (the row exists from claim()).
    await this.db.idempotencyRecord.upsert({
      where: { key }, update: { result: result as object }, create: { key, result: result as object },
    });
  }
}

@Injectable()
export class PrismaWebhookInbox implements WebhookInboxStore {
  constructor(private readonly db: PrismaService) {}
  async seen(eventId: string): Promise<boolean> {
    return (await this.db.webhookInbox.findUnique({ where: { eventId } })) !== null;
  }
  async mark(eventId: string): Promise<void> {
    await this.db.webhookInbox.upsert({ where: { eventId }, update: {}, create: { eventId } });
  }
}
