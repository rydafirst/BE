import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { IsString, Length } from 'class-validator';
import { RequirePermission } from '../../common/auth/roles.decorator.js';
import { CurrentUser, type AuthUser } from '../../common/auth/current-user.decorator.js';
import { ChatService } from './chat.service.js';
import { MAX_MESSAGE_LEN } from './domain/message.js';

class PostMessageDto {
  @IsString() @Length(1, MAX_MESSAGE_LEN) body!: string;
}

@Controller({ path: 'jobs', version: '1' })
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Get(':id/messages')
  @RequirePermission('job:read:own')
  list(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.chat.list(user.id, id);
  }

  @Post(':id/messages')
  @RequirePermission('job:read:own')
  post(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: PostMessageDto) {
    return this.chat.post(user.id, id, dto.body);
  }
}
