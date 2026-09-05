import { Module } from '@nestjs/common';
import { SettingsService } from './settings.service.js';
import { MarketplaceGuard } from './marketplace.guard.js';
import { PublicConfigController } from './public-config.controller.js';
import { SETTINGS_STORE } from './ports.js';
import { InMemorySettingsStore } from './adapters/in-memory-settings.store.js';
import { PrismaSettingsStore } from './adapters/prisma-settings.store.js';

const usePg = process.env.DB_DRIVER === 'postgres';

@Module({
  controllers: [PublicConfigController],
  providers: [
    SettingsService,
    MarketplaceGuard,
    { provide: SETTINGS_STORE, useClass: usePg ? PrismaSettingsStore : InMemorySettingsStore },
  ],
  exports: [SettingsService, MarketplaceGuard],
})
export class SettingsModule {}
