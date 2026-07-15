import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { IsOptional, IsString, Length } from 'class-validator';
import { RequirePermission } from '../../common/auth/roles.decorator.js';
import { CurrentUser, type AuthUser } from '../../common/auth/current-user.decorator.js';
import { ChatService } from './chat.service.js';
import { MAX_MESSAGE_LEN } from './domain/message.js';

class PostMessageDto {
  @IsString() @Length(1, MAX_MESSAGE_LEN) body!: string;
}

class ReportMessageDto {
  @IsOptional() @IsString() @Length(1, 300) reason?: string;
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

  /** Flag an abusive/objectionable message for platform review (App Store Guideline 1.2). */
  @Post(':id/messages/:messageId/report')
  @RequirePermission('job:read:own')
  report(@CurrentUser() user: AuthUser, @Param('id') id: string, @Param('messageId') messageId: string, @Body() dto: ReportMessageDto) {
    return this.chat.report(user.id, id, messageId, dto.reason);
  }
}
