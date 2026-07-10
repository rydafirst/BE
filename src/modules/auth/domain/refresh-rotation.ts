/**
 * Rotating refresh tokens with reuse detection.
 * Each refresh token belongs to a "family". Presenting a token that was already rotated
 * (i.e., a stolen/replayed old token) is treated as compromise -> revoke the whole family.
 */
export interface RefreshTokenState {
  familyId: string;
  tokenHash: string;   // HMAC of the presented refresh token
  rotated: boolean;    // true once it has been exchanged for a newer one
  revoked: boolean;    // true if the family was revoked
}

export type RefreshDecision =
  | { action: 'rotate'; familyId: string }
  | { action: 'reuse_detected'; familyId: string } // revoke family, force re-auth
  | { action: 'reject' };                           // unknown/expired -> generic failure

export function decideRefresh(state: RefreshTokenState | null): RefreshDecision {
  if (!state) return { action: 'reject' };
  if (state.revoked) return { action: 'reject' };
  if (state.rotated) return { action: 'reuse_detected', familyId: state.familyId }; // replay!
  return { action: 'rotate', familyId: state.familyId };
}
