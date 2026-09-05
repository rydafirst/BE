import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { RequirePermission } from '../../common/auth/roles.decorator.js';
import { CurrentUser, type AuthUser } from '../../common/auth/current-user.decorator.js';
import { MarketplaceGuard } from '../settings/marketplace.guard.js';
import { VendorsService } from './vendors.service.js';
import {
  ImageUploadDto, ProductDto, RegisterVendorDto, UpdateProductDto, UpdateVendorDto, VendorAccountDto,
} from './dto/vendors.dto.js';

// The whole customer/vendor-facing surface is gated by the marketplace master switch (admin approval
// endpoints live in a separate controller and stay available so admins can still manage the queue).
@UseGuards(MarketplaceGuard)
@Controller({ path: 'vendors', version: '1' })
export class VendorsController {
  constructor(private readonly vendors: VendorsService) {}

  // ---- Owner (declared before :id so "me"/"mine" aren't read as an id) ----
  @Get('me')
  @RequirePermission('vendor:manage:own')
  mine(@CurrentUser() user: AuthUser) {
    return this.vendors.getMine(user.id);
  }

  @Post()
  @RequirePermission('vendor:manage:own')
  register(@CurrentUser() user: AuthUser, @Body() dto: RegisterVendorDto) {
    return this.vendors.register(user.id, dto);
  }

  @Patch('me')
  @RequirePermission('vendor:manage:own')
  update(@CurrentUser() user: AuthUser, @Body() dto: UpdateVendorDto) {
    return this.vendors.updateMine(user.id, dto);
  }

  @Post('me/logo-upload-url')
  @RequirePermission('vendor:manage:own')
  logoUpload(@CurrentUser() user: AuthUser, @Body() dto: ImageUploadDto) {
    return this.vendors.requestLogoUpload(user.id, dto.contentType, dto.sizeBytes);
  }

  /** Owner captures the shop's business account; server resolves + name-matches it. */
  @Post('me/business-account')
  @RequirePermission('vendor:manage:own')
  businessAccount(@CurrentUser() user: AuthUser, @Body() dto: VendorAccountDto) {
    return this.vendors.captureBusinessAccount(user.id, dto.bankCode, dto.accountNumber);
  }

  // ---- Owner: products ----
  @Get('me/products')
  @RequirePermission('vendor:manage:own')
  myProducts(@CurrentUser() user: AuthUser) {
    return this.vendors.listMyProducts(user.id);
  }

  @Post('me/products')
  @RequirePermission('vendor:manage:own')
  addProduct(@CurrentUser() user: AuthUser, @Body() dto: ProductDto) {
    return this.vendors.addProduct(user.id, dto);
  }

  @Post('me/products/photo-upload-url')
  @RequirePermission('vendor:manage:own')
  productPhotoUpload(@CurrentUser() user: AuthUser, @Body() dto: ImageUploadDto) {
    return this.vendors.requestProductPhotoUpload(user.id, dto.contentType, dto.sizeBytes);
  }

  @Patch('me/products/:productId')
  @RequirePermission('vendor:manage:own')
  updateProduct(@CurrentUser() user: AuthUser, @Param('productId') productId: string, @Body() dto: UpdateProductDto) {
    return this.vendors.updateProduct(user.id, productId, dto);
  }

  @Delete('me/products/:productId')
  @RequirePermission('vendor:manage:own')
  removeProduct(@CurrentUser() user: AuthUser, @Param('productId') productId: string) {
    return this.vendors.removeProduct(user.id, productId);
  }

  // ---- Public browse (any signed-in user) ----
  @Get()
  @RequirePermission('job:read:own')
  list() {
    return this.vendors.listApproved();
  }

  @Get(':id')
  @RequirePermission('job:read:own')
  getOne(@Param('id') id: string) {
    return this.vendors.getPublic(id);
  }

  @Get(':id/products')
  @RequirePermission('job:read:own')
  vendorProducts(@Param('id') id: string) {
    return this.vendors.listVendorProducts(id);
  }
}
