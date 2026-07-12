import { Injectable } from '@nestjs/common';
import type { PresenceStore } from '../ports.js';

// DEV ONLY. In production, Redis-backed (with TTL heartbeats) is the right home for presence.
@Injectable()
export class InMemoryPresenceStore implements PresenceStore {
  private online = new Set<string>();
  async isOnline(riderId: string): Promise<boolean> { return this.online.has(riderId); }
  async setOnline(riderId: string, online: boolean): Promise<void> {
    if (online) this.online.add(riderId);
    else this.online.delete(riderId);
  }
  async listOnline(): Promise<string[]> { return [...this.online]; }
}
