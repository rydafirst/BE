import { HttpException, HttpStatus, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { HmacHasher } from '../../common/security/hmac-hasher.js';
import { checkOtp, generateOtp, OTP_TTL_SECONDS } from './domain/otp.js';
import { decideRefresh } from './domain/refresh-rotation.js';
import {
  OTP_REPO, REFRESH_REPO, USER_REPO, RATE_LIMITER, TOKEN_SIGNER, OTP_SENDER,
  type OtpRepository, type RefreshTokenRepository, type UserRepository,
  type RateLimiter, type TokenSigner, type OtpSender,
} from './ports.js';

const OTP_REQUESTS_PER_HOUR = 5;

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly hasher: HmacHasher,
    @Inject(OTP_REPO) private readonly otps: OtpRepository,
    @Inject(REFRESH_REPO) private readonly refreshes: RefreshTokenRepository,
    @Inject(USER_REPO) private readonly users: UserRepository,
    @Inject(RATE_LIMITER) private readonly limiter: RateLimiter,
    @Inject(TOKEN_SIGNER) private readonly tokens: TokenSigner,
    @Inject(OTP_SENDER) private readonly sender: OtpSender,
  ) {}

  /** Request an OTP. Rate-limited; never reveals whether the number is registered. */
  async requestOtp(phone: string): Promise<void> {
    const allowed = await this.limiter.hit(`otp:${phone}`, OTP_REQUESTS_PER_HOUR, 3600);
    if (!allowed) throw new HttpException('Too many requests', HttpStatus.TOO_MANY_REQUESTS);

    const code = generateOtp();
    await this.otps.save(phone, {
      codeHash: this.hasher.hash(code),
      createdAtMs: Date.now(),
      attempts: 0,
      consumed: false,
    });
    await this.sender.send(phone, code);
    // Always returns 202 regardless of state (no enumeration).
  }

  /** Verify an OTP and issue tokens. Generic failure on any invalid case. */
  async verifyOtp(phone: string, code: string, role: 'CUSTOMER' | 'RIDER' = 'CUSTOMER'): Promise<TokenPair> {
    const record = await this.otps.find(phone);
    if (!record) throw new UnauthorizedException('Invalid code'); // no enumeration

    const matches = this.hasher.verify(code, record.codeHash);
    const result = checkOtp(record, matches, Date.now());
    if (!result.ok) {
      if (result.reason === 'mismatch') await this.otps.incrementAttempts(phone);
      throw new UnauthorizedException('Invalid code');
    }

    await this.otps.markConsumed(phone);
    const user = await this.users.upsertByPhone(phone, role);
    return this.issueTokens(user.id, user.role);
  }

  /** Rotate a refresh token; detect replay of a stolen token and revoke the family. */
  async refresh(presented: string): Promise<TokenPair> {
    const tokenHash = this.hasher.hash(presented);
    const state = await this.refreshes.findByHash(tokenHash);
    const decision = decideRefresh(state);

    if (decision.action === 'reject') throw new UnauthorizedException();
    if (decision.action === 'reuse_detected') {
      await this.refreshes.revokeFamily(decision.familyId);
      throw new UnauthorizedException('Session revoked');
    }
    // rotate
    const newRefresh = this.tokens.newRefreshToken();
    await this.refreshes.rotate(tokenHash, this.hasher.hash(newRefresh));
    const access = this.tokens.signAccess({ sub: 'from-state', role: 'CUSTOMER' });
    return { accessToken: access, refreshToken: newRefresh };
  }

  private async issueTokens(userId: string, role: 'CUSTOMER' | 'RIDER' | 'ADMIN'): Promise<TokenPair> {
    const refresh = this.tokens.newRefreshToken();
    await this.refreshes.createFamily(userId, this.hasher.hash(refresh));
    return { accessToken: this.tokens.signAccess({ sub: userId, role }), refreshToken: refresh };
  }

  ttlSeconds(): number {
    return OTP_TTL_SECONDS;
  }
}
