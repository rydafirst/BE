/** Rider online/offline availability. Authoritative server-side state (survives client reloads). */
export interface PresenceStore {
  isOnline(riderId: string): Promise<boolean>;
  setOnline(riderId: string, online: boolean): Promise<void>;
}

export const PRESENCE_STORE = Symbol('PRESENCE_STORE');
