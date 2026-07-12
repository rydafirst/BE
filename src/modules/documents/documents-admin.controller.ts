import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { IsString, Length } from 'class-validator';
import { CurrentUser, type AuthUser } from '../../common/auth/current-user.decorator.js';
import { RequirePermission } from '../../common/auth/roles.decorator.js';
import { DocumentsService } from './documents.service.js';

class RejectDto {
  @IsString() @Length(3, 300) reason!: string;
}

// Reviewer/admin document approval. Gated by the same scope as KYC review (admin:kyc:review), so an
// admin needs the KYC scope to act. Every route reads/writes only via the service (audited).
@Controller({ path: 'admin/documents', version: '1' })
export class DocumentsAdminController {
  constructor(private readonly documents: DocumentsService) {}

  @Get('queue')
  @RequirePermission('admin:kyc:review')
  queue() {
    return this.documents.reviewQueue();
  }

  @Get('riders/:riderId')
  @RequirePermission('admin:kyc:review')
  rider(@Param('riderId') riderId: string) {
    return this.documents.riderDetail(riderId);
  }

  @Post(':id/approve')
  @RequirePermission('admin:kyc:review')
  approve(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.documents.approveDocument(id, user.id);
  }

  @Post(':id/reject')
  @RequirePermission('admin:kyc:review')
  reject(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: RejectDto) {
    return this.documents.rejectDocument(id, user.id, dto.reason);
  }
}
