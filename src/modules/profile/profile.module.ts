import { Module } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { AvatarService } from './avatar.service.js';
import { ProfileController } from './profile.controller.js';
import { MeController } from './me.controller.js';
import { CUSTOMER_PHOTO } from '../jobs/customer-photo.port.js';

@Module({
  imports: [DocumentsModule, AuthModule], // DOCUMENT_STORE + USER_REPO
  controllers: [ProfileController, MeController],
  providers: [
    AvatarService,
    { provide: CUSTOMER_PHOTO, useExisting: AvatarService },
  ],
  exports: [CUSTOMER_PHOTO],
})
export class ProfileModule {}
