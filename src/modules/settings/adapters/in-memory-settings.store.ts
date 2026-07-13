import { Injectable } from '@nestjs/common';
import type { SettingsStore } from '../ports.js';

/** DEV/tests: operational setting overrides held in memory. */
@Injectable()
export class InMemorySettingsStore implements SettingsStore {
  private kv = new Map<string, string>();
  async getAll(): Promise<Record<string, string>> { return Object.fromEntries(this.kv); }
  async setMany(patch: Record<string, string>): Promise<void> {
    for (const [k, v] of Object.entries(patch)) this.kv.set(k, v);
  }
}
