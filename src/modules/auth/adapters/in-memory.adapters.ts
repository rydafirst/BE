import { Injectable, Logger } from '@nestjs/common';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import type { OtpRecord } from '../domain/otp.js';
import type { RefreshTokenState } from '../domain/refresh-rotation.js';
import type { AdminScope, Role } from '../../../common/auth/roles.js';
import type {
  OtpRepository, RefreshTokenRepository, UserRepository, RateLimiter, TokenSigner, OtpSender,
} from '../ports.js';

// NOTE: DEV ONLY. Replace with Postgres (Prisma) + Redis implementations in the persistence phase.

@Injectable()
export class InMemoryOtpRepo implements OtpRepository {
  private m = new Map<string, OtpRecord>();
  async save(phone: string, r: OtpRecord): Promise<void> { this.m.set(phone, r); }
  async find(phone: string): Promise<OtpRecord | null> { return this.m.get(phone) ?? null; }
  async incrementAttempts(phone: string): Promise<void> {
    const r = this.m.get(phone); if (r) r.attempts += 1;
  }
  async markConsumed(phone: string): Promise<void> {
    const r = this.m.get(phone); if (r) r.consumed = true;
  }
}

@Injectable()
export class InMemoryRefreshRepo implements RefreshTokenRepository {
  private byHash = new Map<string, RefreshTokenState>();
  async findByHash(h: string): Promise<RefreshTokenState | null> { return this.byHash.get(h) ?? null; }
  async createFamily(_userId: string, tokenHash: string): Promise<void> {
    this.byHash.set(tokenHash, { familyId: randomUUID(), tokenHash, rotated: false, revoked: false });
  }
  async rotate(oldHash: string, newHash: string): Promise<void> {
    const old = this.byHash.get(oldHash);
    if (!old) return;
    old.rotated = true;
    this.byHash.set(newHash, { familyId: old.familyId, tokenHash: newHash, rotated: false, revoked: false });
  }
  async revokeFamily(familyId: string): Promise<void> {
    for (const s of this.byHash.values()) if (s.familyId === familyId) s.revoked = true;
  }
}

@Injectable()
export class InMemoryUserRepo implements UserRepository {
  private byPhone = new Map<string, { id: string; role: Role }>();
  async upsertByPhone(phone: string, role: Role): Promise<{ id: string; role: Role }> {
    let u = this.byPhone.get(phone);
    if (!u) { u = { id: randomUUID(), role }; this.byPhone.set(phone, u); return u; }
    // Follow the signed-in role (customer today, rider tomorrow); never downgrade an admin.
    if (u.role !== 'ADMIN') u.role = role;
    return u;
  }
}

@Injectable()
export class InMemoryRateLimiter implements RateLimiter {
  private hits = new Map<string, number[]>();
  async hit(key: string, limit: number, windowSeconds: number): Promise<boolean> {
    const now = Date.now();
    const arr = (this.hits.get(key) ?? []).filter((t) => now - t < windowSeconds * 1000);
    if (arr.length >= limit) { this.hits.set(key, arr); return false; }
    arr.push(now); this.hits.set(key, arr); return true;
  }
}

@Injectable()
export class DevTokenSigner implements TokenSigner {
  // DEV signer (HMAC). Production: RS256 JWT via @nestjs/jwt with rotating keys.
  private secret = process.env.JWT_ACCESS_SECRET ?? 'dev';
  signAccess(payload: { sub: string; role: Role; adminScopes?: AdminScope[] }): string {
    const body = Buffer.from(JSON.stringify({ ...payload, iat: Date.now() })).toString('base64url');
    const sig = createHmac('sha256', this.secret).update(body).digest('base64url');
    return `${body}.${sig}`;
  }
  newRefreshToken(): string { return randomBytes(32).toString('base64url'); }
}

@Injectable()
export class DevOtpSender implements OtpSender {
  private log = new Logger('OtpSender');
  async send(phone: string, code: string): Promise<void> {
    // DEV: log instead of SMS. Production: SMS provider (Termii/Twilio) via outbox.
    this.log.debug(`OTP for ${phone}: ${code}`);
  }
}
