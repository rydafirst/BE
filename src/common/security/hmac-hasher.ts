import { Injectable, Inject } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.validation.js';

/**
 * Deterministic keyed hashing (HMAC-SHA256 + server pepper) for:
 *  - OTP/confirmation codes (so a DB leak never reveals the code), and
 *  - identity blocklist keys (NIN/BVN/device) that must be looked up by value.
 * Deterministic + peppered gives lookup-ability without storing plaintext.
 * Comparisons are constant-time.
 */
@Injectable()
export class HmacHasher {
  private readonly pepper: string;
  constructor(@Inject(ENV) env: Env) {
    this.pepper = env.HASH_PEPPER;
  }

  hash(value: string): string {
    return createHmac('sha256', this.pepper).update(value).digest('hex');
  }

  verify(value: string, expectedHash: string): boolean {
    const a = Buffer.from(this.hash(value), 'hex');
    const b = Buffer.from(expectedHash, 'hex');
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }
}
