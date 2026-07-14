import { Body, Controller, ForbiddenException, Get, Inject, Put } from '@nestjs/common';
import { IsBoolean } from 'class-validator';
import { RequirePermission } from '../../common/auth/roles.decorator.js';
import { CurrentUser, type AuthUser } from '../../common/auth/current-user.decorator.js';
import { PresenceService } from './presence.service.js';
import { DocumentsService } from '../documents/documents.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { RIDER_ACCOUNT_STATUS, type RiderAccountStatus } from '../accounts/rider-account-status.port.js';

class AvailabilityDto {
  @IsBoolean() online!: boolean;
}

// Rider availability. Recorded server-side so it persists across reloads and is authoritative
// for dispatch (only online riders should be offered jobs).
@Controller({ path: 'me/availability', version: '1' })
export class PresenceController {
  constructor(
    private readonly presence: PresenceService,
    private readonly documents: DocumentsService,
    private readonly settings: SettingsService,
    @Inject(RIDER_ACCOUNT_STATUS) private readonly riderAccount: RiderAccountStatus,
  ) {}

  @Get()
  @RequirePermission('job:accept')
  async get(@CurrentUser() user: AuthUser): Promise<{ online: boolean }> {
    return { online: await this.presence.get(user.id) };
  }

  @Put()
  @RequirePermission('job:accept')
  async set(@CurrentUser() user: AuthUser, @Body() dto: AvailabilityDto): Promise<{ online: boolean }> {
    // Fail-closed gate: a rider can only go online once all required documents are approved.
    if (dto.online && (await this.settings.enforceRiderClearance()) && !(await this.documents.isRiderCleared(user.id))) {
      throw new ForbiddenException('Complete your document verification before going online');
    }
    // And only once they have a payout account on file — otherwise there's nowhere to pay them.
    if (dto.online && !(await this.riderAccount.hasAccount(user.id))) {
      throw new ForbiddenException('Add your payout bank account before going online');
    }
    await this.presence.set(user.id, dto.online);
    return { online: dto.online };
  }
}
