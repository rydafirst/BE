import { BadRequestException, HttpException, HttpStatus, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { HmacHasher } from '../../common/security/hmac-hasher.js';
import { checkOtp, generateOtp, OTP_TTL_SECONDS } from './domain/otp.js';
import { decideRefresh } from './domain/refresh-rotation.js';
import { isReviewPhone, parseReviewLogins, reviewCodeMatches, type ReviewLoginConfig } from './domain/review-login.js';
import { ALL_ADMIN_SCOPES, isAdminPhone } from './domain/admin-login.js';
import type { AdminScope } from '../../common/auth/roles.js';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.validation.js';
import { EMAIL_SENDER, type EmailSender } from '../email/email.port.js';
import { otpEmail } from './otp-email.template.js';
import {
  OTP_REPO, REFRESH_REPO, USER_REPO, RATE_LIMITER, TOKEN_SIGNER, OTP_SENDER,
  type OtpRepository, type RefreshTokenRepository, type UserRepository,
  type RateLimiter, type TokenSigner, type OtpSender,
} from './ports.js';

// Default OTP request cap per phone per hour; override via OTP_REQUESTS_PER_HOUR (raise while testing).
const DEFAULT_OTP_REQUESTS_PER_HOUR = 5;

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
    @Inject(EMAIL_SENDER) private readonly email: EmailSender,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Configured store-reviewer identities (empty list => disabled). */
  private reviewCfg(): ReviewLoginConfig {
    return parseReviewLogins(this.env.REVIEW_LOGINS, this.env.REVIEW_LOGIN_PHONE, this.env.REVIEW_LOGIN_OTP);
  }

  /** Request an OTP. Rate-limited; never reveals whether the number is registered. */
  async requestOtp(phone: string, email?: string, name?: string): Promise<void> {
    // App Store reviewer identity: no live code is sent (a fixed code is accepted at verify).
    // Returns 202 like any other request, so the flow is indistinguishable to the client.
    if (isReviewPhone(this.reviewCfg(), phone)) return;

    // Deliver by email while SMS (Termii) is pending business registration — so an email is
    // required for the email channel. Validate BEFORE rate-limiting so a missing field is a
    // plain client error, not a burned attempt.
    if (this.env.OTP_CHANNEL === 'email' && !email) {
      throw new BadRequestException('Email is required to receive your code');
    }

    const perHour = this.env.OTP_REQUESTS_PER_HOUR || DEFAULT_OTP_REQUESTS_PER_HOUR;
    const allowed = await this.limiter.hit(`otp:${phone}`, perHour, 3600);
    if (!allowed) throw new HttpException('Too many requests', HttpStatus.TOO_MANY_REQUESTS);

    // SECURITY (email channel): if an account already exists for this phone, the code is delivered to
    // the email ON FILE — never to the address supplied in this request. Otherwise anyone who knows a
    // phone number could point the login code at their own inbox and take over the account. Only a
    // brand-new phone (no account yet) uses the supplied email, which becomes that account's email on
    // verify. Behaviour is identical from the client's view (always 202), so nothing is enumerable.
    const onFileEmail = await this.users.getEmailByPhone(phone);
    const destinationEmail = onFileEmail ?? email;

    const code = generateOtp();
    await this.otps.save(phone, {
      codeHash: this.hasher.hash(code),
      createdAtMs: Date.now(),
      attempts: 0,
      consumed: false,
      // Bind the account email to the destination we actually sent to: for an existing account this is
      // the on-file address (a no-op on verify), so a request can never rewrite it to an attacker's.
      ...(destinationEmail ? { email: destinationEmail } : {}),
      ...(name ? { name: name.trim() } : {}), // carried to the account on verify (sign-up only)
    });

    if (this.env.OTP_CHANNEL === 'email' && destinationEmail) {
      const minutes = Math.round(OTP_TTL_SECONDS / 60);
      await this.email.send({
        to: destinationEmail,
        subject: `Your Rydafirst code is ${code}`,
        html: otpEmail(code, minutes),
        text: `Your Rydafirst verification code is ${code}. It expires in ${minutes} minutes. Do not share it with anyone.`,
      });
    } else {
      await this.sender.send(phone, code);
    }
    // Always returns 202 regardless of state (no enumeration).
  }

  /** Verify an OTP and issue tokens. Generic failure on any invalid case. */
  async verifyOtp(phone: string, code: string, role: 'CUSTOMER' | 'RIDER' = 'CUSTOMER'): Promise<TokenPair> {
    // App Store reviewer identity: accept the configured fixed code (constant-time), then issue
    // tokens for an ordinary account. Any other code for this phone fails like a normal mismatch.
    if (isReviewPhone(this.reviewCfg(), phone)) {
      if (!reviewCodeMatches(this.reviewCfg(), phone, code)) throw new UnauthorizedException('Invalid code');
      // A fixed-code login doubles as the admin bootstrap: if this phone is also on the admin
      // allowlist, grant ADMIN + scopes (so you can reach the portal without SMS/email set up).
      const admin = isAdminPhone(this.env.ADMIN_PHONES, phone);
      const reviewer = await this.users.upsertByPhone(phone, admin ? 'ADMIN' : role);
      return this.issueTokens(reviewer.id, reviewer.role, admin ? ALL_ADMIN_SCOPES : undefined);
    }

    const record = await this.otps.find(phone);
    if (!record) throw new UnauthorizedException('Invalid code'); // no enumeration

    const matches = this.hasher.verify(code, record.codeHash);
    const result = checkOtp(record, matches, Date.now());
    if (!result.ok) {
      if (result.reason === 'mismatch') await this.otps.incrementAttempts(phone);
      throw new UnauthorizedException('Invalid code');
    }

    await this.otps.markConsumed(phone);
    // An allowlisted admin phone is provisioned as ADMIN with the full review scope set.
    const admin = isAdminPhone(this.env.ADMIN_PHONES, phone);
    const user = await this.users.upsertByPhone(phone, admin ? 'ADMIN' : role, record.email, record.name);
    return this.issueTokens(user.id, user.role, admin ? ALL_ADMIN_SCOPES : undefined);
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

  private async issueTokens(
    userId: string,
    role: 'CUSTOMER' | 'RIDER' | 'ADMIN',
    adminScopes?: readonly AdminScope[],
  ): Promise<TokenPair> {
    const refresh = this.tokens.newRefreshToken();
    await this.refreshes.createFamily(userId, this.hasher.hash(refresh));
    const access = this.tokens.signAccess({
      sub: userId, role,
      ...(adminScopes && adminScopes.length ? { adminScopes: [...adminScopes] } : {}),
    });
    return { accessToken: access, refreshToken: refresh };
  }

  ttlSeconds(): number {
    return OTP_TTL_SECONDS;
  }
}
