import { Module } from '@nestjs/common';
import { PaymentsModule } from '../payments/payments.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { DocumentsModule } from '../documents/documents.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { VendorsController } from './vendors.controller.js';
import { VendorsAdminController } from './vendors-admin.controller.js';
import { VendorsService } from './vendors.service.js';
import { PRODUCT_REPO, VENDOR_REPO } from './ports.js';
import { InMemoryProductRepo, InMemoryVendorRepo } from './adapters/in-memory-vendor.repo.js';
import { PrismaProductRepo, PrismaVendorRepo } from './adapters/prisma-vendor.repo.js';

const usePg = process.env.DB_DRIVER === 'postgres';

@Module({
  imports: [PaymentsModule, NotificationsModule, DocumentsModule, SettingsModule],
  controllers: [VendorsController, VendorsAdminController],
  providers: [
    VendorsService,
    { provide: VENDOR_REPO, useClass: usePg ? PrismaVendorRepo : InMemoryVendorRepo },
    { provide: PRODUCT_REPO, useClass: usePg ? PrismaProductRepo : InMemoryProductRepo },
  ],
  exports: [VendorsService],
})
export class VendorsModule {}
