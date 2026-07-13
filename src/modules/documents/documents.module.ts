import { Module } from '@nestjs/common';
import { DocumentsController } from './documents.controller.js';
import { DocumentsAdminController } from './documents-admin.controller.js';
import { DocumentsService } from './documents.service.js';
import { DOCUMENT_REPO, DOCUMENT_STORE } from './ports.js';
import { InMemoryDocumentRepo } from './adapters/in-memory-document.repo.js';
import { PrismaDocumentRepo } from './adapters/prisma-document.repo.js';
import { InMemoryDocumentStore } from './adapters/in-memory-document.store.js';
import { R2DocumentStore } from './adapters/r2-document.store.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { SettingsModule } from '../settings/settings.module.js';

// Records persist in Postgres when DB_DRIVER=postgres (shared across instances, survive restarts),
// otherwise in memory (dev/tests). Storage uses real Cloudflare R2 when DOCUMENT_STORE_DRIVER=r2
// (env validation enforces the credentials), otherwise the in-memory store.
const usePg = process.env.DB_DRIVER === 'postgres';
const useR2 = process.env.DOCUMENT_STORE_DRIVER === 'r2';

@Module({
  imports: [NotificationsModule, SettingsModule],
  controllers: [DocumentsController, DocumentsAdminController],
  providers: [
    DocumentsService,
    { provide: DOCUMENT_REPO, useClass: usePg ? PrismaDocumentRepo : InMemoryDocumentRepo },
    { provide: DOCUMENT_STORE, useClass: useR2 ? R2DocumentStore : InMemoryDocumentStore },
  ],
  exports: [DocumentsService],
})
export class DocumentsModule {}
