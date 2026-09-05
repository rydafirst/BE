import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { RequirePermission } from '../../common/auth/roles.decorator.js';
import { CurrentUser, type AuthUser } from '../../common/auth/current-user.decorator.js';
import { ChatService } from './chat.service.js';
import { MAX_MESSAGE_LEN } from './domain/message.js';

class PostMessageDto {
  // Body is optional: a voice-note message may carry only audio (or an optional caption).
  @IsOptional() @IsString() @Length(1, MAX_MESSAGE_LEN) body?: string;
  @IsOptional() @IsString() @Length(1, 64) replyToId?: string;
  @IsOptional() @IsString() @Length(1, 256) audioKey?: string;
  @IsOptional() @IsInt() @Min(1) @Max(600000) audioDurationMs?: number;
  @IsOptional() @IsString() @Length(1, 256) imageKey?: string;
}

class AttachmentUploadDto {
  @IsString() @Length(1, 64) contentType!: string;
  @IsInt() @Min(1) sizeBytes!: number;
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
    return this.chat.post(user.id, id, dto.body, dto.replyToId, { ...(dto.audioKey ? { key: dto.audioKey } : {}), ...(dto.audioDurationMs != null ? { durationMs: dto.audioDurationMs } : {}) }, dto.imageKey);
  }

  /** Presigned URL to upload a voice note before sending it as a message on this job. */
  @Post(':id/messages/audio-upload-url')
  @RequirePermission('job:read:own')
  audioUploadUrl(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: AttachmentUploadDto) {
    return this.chat.requestAudioUpload(user.id, id, dto.contentType, dto.sizeBytes);
  }

  /** Presigned URL to upload a photo before sending it as a message on this job. */
  @Post(':id/messages/image-upload-url')
  @RequirePermission('job:read:own')
  imageUploadUrl(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: AttachmentUploadDto) {
    return this.chat.requestImageUpload(user.id, id, dto.contentType, dto.sizeBytes);
  }

  /** Flag an abusive/objectionable message for platform review (App Store Guideline 1.2). */
  @Post(':id/messages/:messageId/report')
  @RequirePermission('job:read:own')
  report(@CurrentUser() user: AuthUser, @Param('id') id: string, @Param('messageId') messageId: string, @Body() dto: ReportMessageDto) {
    return this.chat.report(user.id, id, messageId, dto.reason);
  }
}
