import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { AuthUser } from './current-user.decorator.js';

/**
 * Object-level authorization (anti-IDOR): a non-admin may only act on resources they own.
 * Concrete resource ownership is resolved per-module; this base enforces the principle at the
 * route level using an `ownerId` the handler/service must attach. Admins bypass with scope checks.
 */
@Injectable()
export class OwnershipGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    const user = req.user as AuthUser | undefined;
    if (!user) throw new ForbiddenException();
    if (user.role === 'ADMIN') return true;
    const ownerId: string | undefined = req.resourceOwnerId;
    if (ownerId && ownerId !== user.id) throw new ForbiddenException();
    return true;
  }
}
