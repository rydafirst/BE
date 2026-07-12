import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { IS_PUBLIC_KEY } from './public.decorator.js';
import type { AuthUser } from './current-user.decorator.js';
import type { AdminScope, Role } from './roles.js';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest();
    const header: string | undefined = req.headers?.authorization;
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedException();

    const user = this.verify(header.slice(7));
    if (!user) throw new UnauthorizedException();
    req.user = user;
    return true;
  }

  // DEV verification of DevTokenSigner tokens (HMAC). Production: RS256 JWT verification.
  private verify(token: string): AuthUser | null {
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [body, sig] = parts as [string, string];
    const secret = process.env.JWT_ACCESS_SECRET ?? 'dev';
    const expected = createHmac('sha256', secret).update(body).digest('base64url');
    const a = Buffer.from(sig), b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    try {
      const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as {
        sub: string; role: Role; adminScopes?: AdminScope[];
      };
      return {
        id: payload.sub,
        role: payload.role,
        ...(payload.adminScopes ? { adminScopes: payload.adminScopes } : {}),
      };
    } catch {
      return null;
    }
  }
}
