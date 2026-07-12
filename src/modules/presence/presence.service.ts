import { Inject, Injectable } from '@nestjs/common';
import { PRESENCE_STORE, type PresenceStore } from './ports.js';

@Injectable()
export class PresenceService {
  constructor(@Inject(PRESENCE_STORE) private readonly store: PresenceStore) {}

  get(riderId: string): Promise<boolean> { return this.store.isOnline(riderId); }
  set(riderId: string, online: boolean): Promise<void> { return this.store.setOnline(riderId, online); }
  listOnline(): Promise<string[]> { return this.store.listOnline(); }
}
