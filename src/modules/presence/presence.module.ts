import { Module } from '@nestjs/common';
import { PresenceController } from './presence.controller.js';
import { PresenceService } from './presence.service.js';
import { PRESENCE_STORE } from './ports.js';
import { InMemoryPresenceStore } from './adapters/in-memory-presence.store.js';
import { RedisPresenceStore } from './adapters/redis-presence.store.js';
import { DocumentsModule } from '../documents/documents.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { AccountsModule } from '../accounts/accounts.module.js';

const usePg = process.env.DB_DRIVER === 'postgres';

@Module({
  imports: [DocumentsModule, SettingsModule, AccountsModule],
  controllers: [PresenceController],
  providers: [
    PresenceService,
    { provide: PRESENCE_STORE, useClass: usePg ? RedisPresenceStore : InMemoryPresenceStore },
  ],
  exports: [PresenceService],
})
export class PresenceModule {}
