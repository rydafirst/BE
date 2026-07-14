import { Body, Controller, Get, Post } from '@nestjs/common';
import { IsIn, IsString } from 'class-validator';
import { RequirePermission } from '../../common/auth/roles.decorator.js';
import { CurrentUser, type AuthUser } from '../../common/auth/current-user.decorator.js';
import { AvatarService } from './avatar.service.js';

class AvatarUploadDto {
  @IsString() @IsIn(['image/jpeg', 'image/png', 'image/webp']) contentType!: string;
}

@Controller({ path: 'me/avatar', version: '1' })
export class ProfileController {
  constructor(private readonly avatars: AvatarService) {}

  /** Request a one-time upload URL for my avatar (client PUTs the image directly to storage). */
  @Post('upload-url')
  @RequirePermission('account:manage:own')
  requestUpload(@CurrentUser() user: AuthUser, @Body() dto: AvatarUploadDto) {
    return this.avatars.requestUpload(user.id, dto.contentType);
  }

  /** My current avatar (short-lived signed URL), or null. */
  @Get()
  @RequirePermission('account:manage:own')
  async mine(@CurrentUser() user: AuthUser) {
    return { photoUrl: await this.avatars.photoUrl(user.id) };
  }
}
