/** Persistence port for the identity blocklist. Stores HASHED keys only. */
export interface IdentityBlocklistRepository {
  isBlocked(hashes: { ninHash?: string; bvnHash?: string; deviceHash?: string }): Promise<boolean>;
  block(entry: {
    ninHash?: string;
    bvnHash?: string;
    deviceHash?: string;
    reason: string;
  }): Promise<void>;
}

export const IDENTITY_BLOCKLIST_REPO = Symbol('IDENTITY_BLOCKLIST_REPO');
