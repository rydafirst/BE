/** Rider online/offline availability. Authoritative server-side state (survives client reloads). */
export interface PresenceStore {
  isOnline(riderId: string): Promise<boolean>;
  setOnline(riderId: string, online: boolean): Promise<void>;
  /** All riders currently online (used to broadcast new jobs to the pool). */
  listOnline(): Promise<string[]>;
}

export const PRESENCE_STORE = Symbol('PRESENCE_STORE');
