import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service.js';
import type { SettingsStore } from '../ports.js';

/** Postgres-backed operational settings (one row per key). */
@Injectable()
export class PrismaSettingsStore implements SettingsStore {
  constructor(private readonly db: PrismaService) {}

  async getAll(): Promise<Record<string, string>> {
    const rows = (await this.db.setting.findMany()) as { key: string; value: string }[];
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }
  async setMany(patch: Record<string, string>): Promise<void> {
    for (const [key, value] of Object.entries(patch)) {
      await this.db.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
    }
  }
}
