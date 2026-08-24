import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { IsIn, IsOptional, IsString, Length } from 'class-validator';
import { RequirePermission } from '../../common/auth/roles.decorator.js';
import { CurrentUser, type AuthUser } from '../../common/auth/current-user.decorator.js';
import { MAX_MESSAGE_LEN } from '../chat/domain/message.js';
import { SUPPORT_CATEGORIES, type SupportCategory } from './domain/support.js';
import { SupportService } from './support.service.js';

class StartThreadDto {
  @IsIn(SUPPORT_CATEGORIES as unknown as string[]) category!: SupportCategory;
  @IsOptional() @IsString() @Length(1, 64) jobId?: string;
}

class AnswerDto {
  @IsString() @Length(1, MAX_MESSAGE_LEN) answer!: string;
}

class MessageDto {
  @IsString() @Length(1, MAX_MESSAGE_LEN) body!: string;
}

@Controller({ path: 'support', version: '1' })
export class SupportController {
  constructor(private readonly support: SupportService) {}

  // ---- User endpoints (any authenticated user) ----

  @Post('threads')
  @RequirePermission('account:manage:own')
  start(@CurrentUser() user: AuthUser, @Body() dto: StartThreadDto) {
    return this.support.startThread(user.id, dto.category, dto.jobId);
  }

  @Post('threads/:id/answer')
  @RequirePermission('account:manage:own')
  answer(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: AnswerDto) {
    return this.support.answerBot(user.id, id, dto.answer);
  }

  @Post('threads/:id/messages')
  @RequirePermission('account:manage:own')
  post(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: MessageDto) {
    return this.support.postMessage(user.id, id, dto.body);
  }

  @Get('threads')
  @RequirePermission('account:manage:own')
  myThreads(@CurrentUser() user: AuthUser) {
    return this.support.listMyThreads(user.id);
  }

  @Get('threads/:id/messages')
  @RequirePermission('account:manage:own')
  messages(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.support.listMessages(user.id, id);
  }

  // ---- Agent endpoints (SUPPORT scope) ----

  @Get('agent/threads')
  @RequirePermission('admin:support:manage')
  openThreads(@CurrentUser() user: AuthUser) {
    return this.support.listOpenThreads(user.id);
  }

  @Get('agent/threads/:id/messages')
  @RequirePermission('admin:support:manage')
  agentThread(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.support.listThreadForAgent(user.id, id);
  }

  @Post('agent/threads/:id/reply')
  @RequirePermission('admin:support:manage')
  reply(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: MessageDto) {
    return this.support.agentReply(user.id, id, dto.body);
  }

  @Post('agent/threads/:id/resolve')
  @RequirePermission('admin:support:manage')
  resolve(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.support.resolveThread(user.id, id);
  }
}
