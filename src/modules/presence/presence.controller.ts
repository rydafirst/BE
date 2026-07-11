import { Body, Controller, Get, Put } from '@nestjs/common';
import { IsBoolean } from 'class-validator';
import { RequirePermission } from '../../common/auth/roles.decorator.js';
import { CurrentUser, type AuthUser } from '../../common/auth/current-user.decorator.js';
import { PresenceService } from './presence.service.js';

class AvailabilityDto {
  @IsBoolean() online!: boolean;
}

// Rider availability. Recorded server-side so it persists across reloads and is authoritative
// for dispatch (only online riders should be offered jobs).
@Controller({ path: 'me/availability', version: '1' })
export class PresenceController {
  constructor(private readonly presence: PresenceService) {}

  @Get()
  @RequirePermission('job:accept')
  async get(@CurrentUser() user: AuthUser): Promise<{ online: boolean }> {
    return { online: await this.presence.get(user.id) };
  }

  @Put()
  @RequirePermission('job:accept')
  async set(@CurrentUser() user: AuthUser, @Body() dto: AvailabilityDto): Promise<{ online: boolean }> {
    await this.presence.set(user.id, dto.online);
    return { online: dto.online };
  }
}
