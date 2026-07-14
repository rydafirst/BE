import { Controller, Get, Inject } from '@nestjs/common';
import { RequirePermission } from '../../common/auth/roles.decorator.js';
import { CurrentUser, type AuthUser } from '../../common/auth/current-user.decorator.js';
import { USER_REPO, type UserRepository } from '../auth/ports.js';

@Controller({ path: 'me', version: '1' })
export class MeController {
  constructor(@Inject(USER_REPO) private readonly users: UserRepository) {}

  /** The signed-in user's own basic profile (their phone is shown on the profile screen). */
  @Get()
  @RequirePermission('account:manage:own')
  async me(@CurrentUser() user: AuthUser) {
    return { id: user.id, phone: await this.users.getPhone(user.id) };
  }
}
