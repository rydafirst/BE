import { Module } from '@nestjs/common';
import { DocumentsController } from './documents.controller.js';
import { DocumentsAdminController } from './documents-admin.controller.js';
import { DocumentsService } from './documents.service.js';
import { DOCUMENT_REPO, DOCUMENT_STORE } from './ports.js';
import { InMemoryDocumentRepo } from './adapters/in-memory-document.repo.js';
import { InMemoryDocumentStore } from './adapters/in-memory-document.store.js';
import { R2DocumentStore } from './adapters/r2-document.store.js';
import { NotificationsModule } from '../notifications/notifications.module.js';

// Storage is chosen behind the DOCUMENT_STORE port: real Cloudflare R2 when DOCUMENT_STORE_DRIVER=r2
// (bucket + credentials required — env validation enforces this), otherwise the in-memory store,
// which keeps the whole flow runnable and testable without a bucket.
const useR2 = process.env.DOCUMENT_STORE_DRIVER === 'r2';

@Module({
  imports: [NotificationsModule],
  controllers: [DocumentsController, DocumentsAdminController],
  providers: [
    DocumentsService,
    { provide: DOCUMENT_REPO, useClass: InMemoryDocumentRepo },
    { provide: DOCUMENT_STORE, useClass: useR2 ? R2DocumentStore : InMemoryDocumentStore },
  ],
  exports: [DocumentsService],
})
export class DocumentsModule {}
