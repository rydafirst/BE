/** Roles and a coarse permission matrix. Fine-grained admin sub-roles layer on top. */
export type Role = 'CUSTOMER' | 'RIDER' | 'ADMIN';
export type AdminScope = 'KYC' | 'DISPUTE' | 'FINANCE' | 'OPS';

export type Permission =
  | 'job:create'
  | 'job:accept'
  | 'job:read:own'
  | 'wallet:read:own'
  | 'account:manage:own'
  | 'payout:request'
  | 'rider:documents:manage'
  | 'admin:kyc:review'
  | 'admin:dispute:resolve'
  | 'admin:finance:read'
  | 'admin:settings:manage';

const MATRIX: Readonly<Record<Role, readonly Permission[]>> = {
  CUSTOMER: ['job:create', 'job:read:own', 'wallet:read:own', 'account:manage:own'],
  RIDER: ['job:accept', 'job:read:own', 'wallet:read:own', 'account:manage:own', 'payout:request', 'rider:documents:manage'],
  ADMIN: ['admin:kyc:review', 'admin:dispute:resolve', 'admin:finance:read', 'admin:settings:manage'],
};

/** Deny-by-default: a role has a permission only if explicitly granted. */
export function roleHasPermission(role: Role, perm: Permission): boolean {
  return MATRIX[role].includes(perm);
}

/** Admin actions additionally require the matching scope. */
export function adminCan(scopes: readonly AdminScope[], perm: Permission): boolean {
  if (perm === 'admin:kyc:review') return scopes.includes('KYC');
  if (perm === 'admin:dispute:resolve') return scopes.includes('DISPUTE');
  if (perm === 'admin:finance:read') return scopes.includes('FINANCE');
  if (perm === 'admin:settings:manage') return scopes.includes('OPS');
  return false;
}
