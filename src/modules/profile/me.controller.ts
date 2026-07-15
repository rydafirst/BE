import { Controller, Delete, Get, HttpCode, Inject } from '@nestjs/common';
import { RequirePermission } from '../../common/auth/roles.decorator.js';
import { CurrentUser, type AuthUser } from '../../common/auth/current-user.decorator.js';
import { USER_REPO, REFRESH_REPO, type UserRepository, type RefreshTokenRepository } from '../auth/ports.js';

@Controller({ path: 'me', version: '1' })
export class MeController {
  constructor(
    @Inject(USER_REPO) private readonly users: UserRepository,
    @Inject(REFRESH_REPO) private readonly refreshes: RefreshTokenRepository,
  ) {}

  /** The signed-in user's own basic profile (their phone is shown on the profile screen). */
  @Get()
  @RequirePermission('account:manage:own')
  async me(@CurrentUser() user: AuthUser) {
    return { id: user.id, phone: await this.users.getPhone(user.id) };
  }

  /**
   * Delete the signed-in user's account: erase their personal data and sign them out everywhere
   * (Google Play "account deletion" requirement / GDPR right to erasure). Only ever acts on the
   * caller's own id. Financial/ledger records are retained (anonymised) for the period the law
   * requires — see the privacy policy and /delete-account.
   */
  @Delete()
  @HttpCode(200)
  @RequirePermission('account:manage:own')
  async deleteMyAccount(@CurrentUser() user: AuthUser) {
    await this.users.anonymize(user.id);
    await this.refreshes.revokeAllForUser(user.id);
    return { deleted: true };
  }
}
