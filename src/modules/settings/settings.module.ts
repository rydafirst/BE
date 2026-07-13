import { Module } from '@nestjs/common';
import { SettingsService } from './settings.service.js';
import { SETTINGS_STORE } from './ports.js';
import { InMemorySettingsStore } from './adapters/in-memory-settings.store.js';
import { PrismaSettingsStore } from './adapters/prisma-settings.store.js';

const usePg = process.env.DB_DRIVER === 'postgres';

@Module({
  providers: [
    SettingsService,
    { provide: SETTINGS_STORE, useClass: usePg ? PrismaSettingsStore : InMemorySettingsStore },
  ],
  exports: [SettingsService],
})
export class SettingsModule {}
