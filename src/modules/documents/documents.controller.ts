import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import { IsIn, IsInt, IsOptional, IsPositive, IsString, Length } from 'class-validator';
import { CurrentUser, type AuthUser } from '../../common/auth/current-user.decorator.js';
import { RequirePermission } from '../../common/auth/roles.decorator.js';
import { DocumentsService } from './documents.service.js';
import type { DocumentType, VehicleTrack } from './domain/document-catalog.js';

const TRACKS: VehicleTrack[] = ['BIKE', 'CAR', 'KEKE'];
const TYPES: DocumentType[] = [
  'PROFILE_PHOTO', 'GOV_ID', 'LICENSE', 'ADDRESS_PROOF', 'VEHICLE_REG', 'PROOF_OF_OWNERSHIP',
  'ROADWORTHINESS', 'INSURANCE', 'VEHICLE_PHOTO', 'GUARANTOR', 'LASRRA', 'LASDRI', 'HACKNEY_PERMIT', 'KEKE_PERMIT',
];

class SetTrackDto { @IsIn(TRACKS) track!: VehicleTrack; }

class UploadDto {
  @IsIn(TYPES) type!: DocumentType;
  @IsString() @Length(1, 100) contentType!: string;
  @IsOptional() @IsInt() @IsPositive() issuedAt?: number;
  @IsOptional() @IsInt() @IsPositive() expiresAt?: number;
}

// Rider-facing document onboarding. Every route is scoped to the signed-in rider (their own id);
// a rider can only read/write their own documents. Reviewer/admin routes live in Phase B.
@Controller({ path: 'me/documents', version: '1' })
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Get()
  @RequirePermission('rider:documents:manage')
  checklist(@CurrentUser() user: AuthUser) {
    return this.documents.checklist(user.id);
  }

  @Put('track')
  @RequirePermission('rider:documents:manage')
  setTrack(@CurrentUser() user: AuthUser, @Body() dto: SetTrackDto) {
    return this.documents.setTrack(user.id, dto.track);
  }

  @Post('upload-url')
  @RequirePermission('rider:documents:manage')
  requestUpload(@CurrentUser() user: AuthUser, @Body() dto: UploadDto) {
    return this.documents.requestUpload(user.id, dto);
  }

  @Get(':id/url')
  @RequirePermission('rider:documents:manage')
  ownDocumentUrl(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.documents.ownDocumentUrl(user.id, id);
  }
}
