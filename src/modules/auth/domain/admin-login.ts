import type { AdminScope } from '../../../common/auth/roles.js';

// An allowlisted admin phone is granted the full set of review scopes on login. Provisioning admins
// via an env allowlist (ADMIN_PHONES) keeps it simple and auditable — no self-service admin signup.
export const ALL_ADMIN_SCOPES: readonly AdminScope[] = ['KYC', 'DISPUTE', 'FINANCE', 'OPS'];

/** True when `phone` is on the (non-empty) admin allowlist. Exact match after trimming. */
export function isAdminPhone(adminPhones: readonly string[], phone: string): boolean {
  const p = phone.trim();
  if (!p) return false;
  return adminPhones.some((a) => a.trim() === p);
}
