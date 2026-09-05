import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { RequirePermission } from '../../common/auth/roles.decorator.js';
import { VendorsService } from './vendors.service.js';
import { RejectVendorDto } from './dto/vendors.dto.js';

// Admin vendor approval (business KYC). Gated by the KYC review scope, same as rider document review.
@Controller({ path: 'admin/vendors', version: '1' })
export class VendorsAdminController {
  constructor(private readonly vendors: VendorsService) {}

  @Get('pending')
  @RequirePermission('admin:kyc:review')
  pending() {
    return this.vendors.listPending();
  }

  @Post(':id/approve')
  @RequirePermission('admin:kyc:review')
  approve(@Param('id') id: string) {
    return this.vendors.approve(id);
  }

  @Post(':id/reject')
  @RequirePermission('admin:kyc:review')
  reject(@Param('id') id: string, @Body() dto: RejectVendorDto) {
    return this.vendors.reject(id, dto.reason);
  }

  @Post(':id/suspend')
  @RequirePermission('admin:kyc:review')
  suspend(@Param('id') id: string) {
    return this.vendors.suspend(id);
  }
}
