import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Role, AdminScope } from './roles.js';

export interface AuthUser {
  id: string;
  role: Role;
  adminScopes?: AdminScope[];
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => ctx.switchToHttp().getRequest().user,
);
