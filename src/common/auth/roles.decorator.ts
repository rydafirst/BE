import { SetMetadata } from '@nestjs/common';
import type { Permission } from './roles.js';

export const PERMISSION_KEY = 'required_permission';
/** Attach the permission a route requires. Absent = authenticated-only. */
export const RequirePermission = (perm: Permission): MethodDecorator =>
  SetMetadata(PERMISSION_KEY, perm);
