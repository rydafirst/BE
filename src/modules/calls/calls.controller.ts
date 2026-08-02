import { Controller, HttpCode, Param, Post } from '@nestjs/common';
import { RequirePermission } from '../../common/auth/roles.decorator.js';
import { CurrentUser, type AuthUser } from '../../common/auth/current-user.decorator.js';
import { CallSessionService } from './call-session.service.js';

@Controller({ path: 'jobs', version: '1' })
export class CallsController {
  constructor(private readonly calls: CallSessionService) {}

  /**
   * Start a masked call to the other party of this delivery. Coarse RBAC only requires an account;
   * the real check (caller is the job's customer or rider, and the call window is open) is enforced
   * inside the service. Rings the caller's phone; nothing sensitive is returned.
   */
  @Post(':jobId/call')
  @HttpCode(200)
  @RequirePermission('account:manage:own')
  requestCall(@CurrentUser() user: AuthUser, @Param('jobId') jobId: string): Promise<{ status: 'ringing' }> {
    return this.calls.initiate({ jobId, callerUserId: user.id });
  }
}
