import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSION_KEY } from './roles.decorator.js';
import { adminCan, roleHasPermission, type Permission } from './roles.js';
import type { AuthUser } from './current-user.decorator.js';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Permission | undefined>(PERMISSION_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!required) return true; // authenticated-only route

    const user = ctx.switchToHttp().getRequest().user as AuthUser | undefined;
    if (!user) throw new ForbiddenException();

    if (!roleHasPermission(user.role, required)) throw new ForbiddenException();
    if (user.role === 'ADMIN' && required.startsWith('admin:')) {
      if (!adminCan(user.adminScopes ?? [], required)) throw new ForbiddenException();
    }
    return true;
  }
}
