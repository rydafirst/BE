import type { OtpRecord } from './domain/otp.js';
import type { RefreshTokenState } from './domain/refresh-rotation.js';
import type { AdminScope, Role } from '../../common/auth/roles.js';

export interface OtpRepository {
  save(phone: string, record: OtpRecord): Promise<void>;
  find(phone: string): Promise<OtpRecord | null>;
  incrementAttempts(phone: string): Promise<void>;
  markConsumed(phone: string): Promise<void>;
}
export const OTP_REPO = Symbol('OTP_REPO');

export interface RefreshTokenRepository {
  findByHash(tokenHash: string): Promise<RefreshTokenState | null>;
  createFamily(userId: string, tokenHash: string): Promise<void>;
  rotate(oldHash: string, newHash: string): Promise<void>;
  revokeFamily(familyId: string): Promise<void>;
}
export const REFRESH_REPO = Symbol('REFRESH_REPO');

export interface UserRepository {
  upsertByPhone(phone: string, role: Role, email?: string, name?: string): Promise<{ id: string; role: Role }>;
  /** The user's email on file (for payment receipts / mail trail), or null. */
  getEmail(userId: string): Promise<string | null>;
  /** The user's phone number (their own — shown on their profile), or null. */
  getPhone(userId: string): Promise<string | null>;
  /** The user's avatar object key, or null. */
  getPhotoKey(userId: string): Promise<string | null>;
  /** Persist the user's avatar object key after an upload. */
  setPhotoKey(userId: string, key: string): Promise<void>;
}
export const USER_REPO = Symbol('USER_REPO');

/** Sliding-window rate limiter (Redis-backed in prod). */
export interface RateLimiter {
  hit(key: string, limit: number, windowSeconds: number): Promise<boolean>; // true = allowed
}
export const RATE_LIMITER = Symbol('RATE_LIMITER');

export interface TokenSigner {
  signAccess(payload: { sub: string; role: Role; adminScopes?: AdminScope[] }): string;
  newRefreshToken(): string; // opaque random token (stored hashed)
}
export const TOKEN_SIGNER = Symbol('TOKEN_SIGNER');

export interface OtpSender {
  send(phone: string, code: string): Promise<void>;
}
export const OTP_SENDER = Symbol('OTP_SENDER');
