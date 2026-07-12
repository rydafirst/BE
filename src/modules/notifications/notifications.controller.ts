import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { IsIn, IsString, Length } from 'class-validator';
import { CurrentUser, type AuthUser } from '../../common/auth/current-user.decorator.js';
import { NotificationsService } from './notifications.service.js';

class RegisterTokenDto {
  @IsString() @Length(1, 200) token!: string;
  @IsIn(['ios', 'android']) platform!: 'ios' | 'android';
}

// A user's own in-app notification feed (the bell + list) and device push-token registration.
// Authenticated-only; each user reads/writes only their own data (keyed to the token's user id).
@Controller({ path: 'me/notifications', version: '1' })
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  async list(@CurrentUser() user: AuthUser) {
    const [items, unread] = await Promise.all([
      this.notifications.list(user.id),
      this.notifications.unread(user.id),
    ]);
    return { items, unread };
  }

  @Post('read')
  async read(@CurrentUser() user: AuthUser) {
    await this.notifications.markRead(user.id);
    return { ok: true };
  }

  // Register this device to receive push notifications for the signed-in user.
  @Post('tokens')
  async registerToken(@CurrentUser() user: AuthUser, @Body() dto: RegisterTokenDto) {
    await this.notifications.registerToken(user.id, { token: dto.token, platform: dto.platform });
    return { ok: true };
  }

  // Remove a device token (e.g. on sign-out).
  @Delete('tokens/:token')
  async unregisterToken(@CurrentUser() user: AuthUser, @Param('token') token: string) {
    await this.notifications.unregisterToken(user.id, token);
    return { ok: true };
  }
}
