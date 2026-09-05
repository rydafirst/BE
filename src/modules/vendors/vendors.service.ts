import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { EscrowService } from '../payments/escrow.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { DOCUMENT_STORE, type DocumentStore } from '../documents/ports.js';
import { namesMatch } from '../payments/domain/name-match.js';
import {
  PRODUCT_REPO, VENDOR_REPO, type Product, type ProductRepo, type Vendor, type VendorRepo,
} from './ports.js';

const LOGO_UPLOAD_TTL = 300;
const ASSET_VIEW_TTL = 3600;
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const LIST_LIMIT = 200;
const IMAGE_EXT: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heif',
};

/**
 * Marketplace vendors. A user registers one shop (PENDING), captures a name-verified BUSINESS payout
 * account, and an admin approves it (business KYC) before it goes live. Vendors are ONLY ever paid to
 * a business account whose resolved name matches the business — the same customer-money guardrail used
 * for ad-hoc errand payouts.
 */
@Injectable()
export class VendorsService {
  constructor(
    @Inject(VENDOR_REPO) private readonly vendors: VendorRepo,
    @Inject(PRODUCT_REPO) private readonly products: ProductRepo,
    @Inject(DOCUMENT_STORE) private readonly store: DocumentStore,
    private readonly escrow: EscrowService,
    private readonly notify: NotificationsService,
  ) {}

  // ---------- Owner: onboarding ----------
  async register(ownerUserId: string, dto: { businessName: string; rcNumber?: string; category?: string; area?: string; description?: string }): Promise<Vendor> {
    const existing = await this.vendors.findByOwner(ownerUserId);
    if (existing) throw new ConflictException('You already have a vendor profile');
    const name = dto.businessName.trim();
    if (name.length < 2) throw new BadRequestException('Enter your business name');
    const v = await this.vendors.create({
      ownerUserId, businessName: name,
      ...(dto.rcNumber ? { rcNumber: dto.rcNumber.trim() } : {}),
      ...(dto.category ? { category: dto.category.trim() } : {}),
      ...(dto.area ? { area: dto.area.trim() } : {}),
      ...(dto.description ? { description: dto.description.trim() } : {}),
    });
    return this.withLogoUrl(v);
  }

  async getMine(ownerUserId: string): Promise<Vendor | null> {
    const v = await this.vendors.findByOwner(ownerUserId);
    return v ? this.withLogoUrl(v) : null;
  }

  private async mustOwn(ownerUserId: string): Promise<Vendor> {
    const v = await this.vendors.findByOwner(ownerUserId);
    if (!v) throw new NotFoundException('You have not registered a vendor profile yet');
    return v;
  }

  async updateMine(ownerUserId: string, patch: { businessName?: string; rcNumber?: string; category?: string; area?: string; description?: string; logoKey?: string; shopLat?: number; shopLng?: number }): Promise<Vendor> {
    const v = await this.mustOwn(ownerUserId);
    const logoKey = patch.logoKey && patch.logoKey.startsWith(`vendor-logo/${v.id}/`) ? patch.logoKey : undefined;
    const validLoc = patch.shopLat != null && patch.shopLng != null
      && Math.abs(patch.shopLat) <= 90 && Math.abs(patch.shopLng) <= 180;
    // Editing business identity after approval sends the vendor back to PENDING re-review (KYC integrity).
    const identityChanged = (patch.businessName != null && patch.businessName.trim() !== v.businessName) || (patch.rcNumber != null && patch.rcNumber.trim() !== (v.rcNumber ?? ''));
    const updated = await this.vendors.update(v.id, {
      ...(patch.businessName ? { businessName: patch.businessName.trim() } : {}),
      ...(patch.rcNumber != null ? { rcNumber: patch.rcNumber.trim() } : {}),
      ...(patch.category != null ? { category: patch.category.trim() } : {}),
      ...(patch.area != null ? { area: patch.area.trim() } : {}),
      ...(patch.description != null ? { description: patch.description.trim() } : {}),
      ...(logoKey ? { logoKey } : {}),
      ...(validLoc ? { shopLat: patch.shopLat, shopLng: patch.shopLng } : {}),
      ...(identityChanged && v.status === 'APPROVED' ? { status: 'PENDING' as const, approvedAt: null } : {}),
    });
    return this.withLogoUrl(updated!);
  }

  /** Presigned URL for a vendor logo upload. */
  async requestLogoUpload(ownerUserId: string, contentType: string, sizeBytes: number): Promise<{ uploadUrl: string; key: string }> {
    const v = await this.mustOwn(ownerUserId);
    return this.presignImage(`vendor-logo/${v.id}`, contentType, sizeBytes);
  }

  /**
   * Owner captures the shop's BUSINESS account. The server resolves the real account name and scores it
   * against the business name; on a clear match the account is auto-verified, otherwise it's stored for
   * an admin to vouch for at approval. Only bankCode + number are trusted from the client.
   */
  async captureBusinessAccount(ownerUserId: string, bankCode: string, accountNumber: string): Promise<{ accountName: string; match: boolean }> {
    const v = await this.mustOwn(ownerUserId);
    const { accountName } = await this.escrow.resolveAccount(bankCode, accountNumber);
    const match = namesMatch(v.businessName, accountName);
    await this.vendors.update(v.id, { account: { bankCode, accountNumber, accountName }, accountVerified: match });
    return { accountName, match };
  }

  // ---------- Public: browse ----------
  async listApproved(): Promise<Vendor[]> {
    const list = await this.vendors.listApproved(LIST_LIMIT);
    return Promise.all(list.map(async (v) => stripPrivate(await this.withLogoUrl(v))));
  }

  async getPublic(vendorId: string): Promise<Vendor> {
    const v = await this.vendors.findById(vendorId);
    if (!v || v.status !== 'APPROVED') throw new NotFoundException('Vendor not found');
    return stripPrivate(await this.withLogoUrl(v));
  }

  /** Internal (never exposed over HTTP): the full APPROVED vendor + account/location for order creation. */
  async getForOrder(vendorId: string): Promise<Vendor> {
    const v = await this.vendors.findById(vendorId);
    if (!v || v.status !== 'APPROVED') throw new NotFoundException('Vendor not available');
    return v;
  }

  /** Internal: look up specific products (for authoritative pricing at checkout). */
  async findProduct(productId: string): Promise<Product | null> {
    return this.products.findById(productId);
  }

  /** Internal: the vendor id owned by a user (for the vendor's own order list). */
  async findVendorIdByOwner(ownerUserId: string): Promise<string | null> {
    const v = await this.vendors.findByOwner(ownerUserId);
    return v?.id ?? null;
  }

  // ---------- Admin: approval queue ----------
  async listPending(): Promise<Vendor[]> {
    const list = await this.vendors.listByStatus('PENDING', LIST_LIMIT);
    return Promise.all(list.map((v) => this.withLogoUrl(v)));
  }

  async approve(vendorId: string): Promise<Vendor> {
    const v = await this.vendors.findById(vendorId);
    if (!v) throw new NotFoundException('Vendor not found');
    if (!v.account) throw new ConflictException('This vendor has not added a business account yet');
    const updated = await this.vendors.update(vendorId, { status: 'APPROVED', approvedAt: Date.now(), rejectionReason: null, accountVerified: true });
    try { await this.notify.record(v.ownerUserId, { title: 'Your shop is live', body: 'Your vendor profile was approved — you can start listing products now.' }); } catch { /* best-effort */ }
    return this.withLogoUrl(updated!);
  }

  async reject(vendorId: string, reason: string): Promise<Vendor> {
    const v = await this.vendors.findById(vendorId);
    if (!v) throw new NotFoundException('Vendor not found');
    const updated = await this.vendors.update(vendorId, { status: 'REJECTED', rejectionReason: reason.trim().slice(0, 300) || 'Not approved', approvedAt: null });
    try { await this.notify.record(v.ownerUserId, { title: 'Vendor application update', body: 'Your vendor profile needs changes before it can go live. Open the app to see why.' }); } catch { /* best-effort */ }
    return this.withLogoUrl(updated!);
  }

  async suspend(vendorId: string): Promise<Vendor> {
    const v = await this.vendors.findById(vendorId);
    if (!v) throw new NotFoundException('Vendor not found');
    const updated = await this.vendors.update(vendorId, { status: 'SUSPENDED' });
    return this.withLogoUrl(updated!);
  }

  // ---------- Products (catalog) ----------
  async addProduct(ownerUserId: string, dto: { name: string; priceMinor: number; description?: string; photoKeys?: string[]; available?: boolean }): Promise<Product> {
    const v = await this.mustOwn(ownerUserId);
    const name = dto.name.trim();
    if (name.length < 1) throw new BadRequestException('Enter the product name');
    const priceMinor = Math.round(dto.priceMinor);
    if (!Number.isInteger(priceMinor) || priceMinor < 1 || priceMinor > 100_000_000) throw new BadRequestException('Enter a valid price');
    const photoKeys = (dto.photoKeys ?? []).filter((k) => k.startsWith(`vendor-product/${v.id}/`)).slice(0, 6);
    const p = await this.products.create({
      vendorId: v.id, name, priceMinor,
      ...(dto.description ? { description: dto.description.trim() } : {}),
      ...(photoKeys.length ? { photoKeys } : {}),
      ...(dto.available != null ? { available: dto.available } : {}),
    });
    return this.withProductUrls(p);
  }

  async listMyProducts(ownerUserId: string): Promise<Product[]> {
    const v = await this.mustOwn(ownerUserId);
    const list = await this.products.listByVendor(v.id);
    return Promise.all(list.map((p) => this.withProductUrls(p)));
  }

  async listVendorProducts(vendorId: string): Promise<Product[]> {
    const v = await this.vendors.findById(vendorId);
    if (!v || v.status !== 'APPROVED') throw new NotFoundException('Vendor not found');
    const list = await this.products.listByVendor(vendorId, { availableOnly: true });
    return Promise.all(list.map((p) => this.withProductUrls(p)));
  }

  async updateProduct(ownerUserId: string, productId: string, patch: { name?: string; priceMinor?: number; description?: string; photoKeys?: string[]; available?: boolean }): Promise<Product> {
    const v = await this.mustOwn(ownerUserId);
    const p = await this.products.findById(productId);
    if (!p || p.vendorId !== v.id) throw new NotFoundException('Product not found');
    let priceMinor: number | undefined;
    if (patch.priceMinor != null) {
      priceMinor = Math.round(patch.priceMinor);
      if (!Number.isInteger(priceMinor) || priceMinor < 1 || priceMinor > 100_000_000) throw new BadRequestException('Enter a valid price');
    }
    const photoKeys = patch.photoKeys ? patch.photoKeys.filter((k) => k.startsWith(`vendor-product/${v.id}/`)).slice(0, 6) : undefined;
    const updated = await this.products.update(productId, {
      ...(patch.name ? { name: patch.name.trim() } : {}),
      ...(priceMinor != null ? { priceMinor } : {}),
      ...(patch.description != null ? { description: patch.description.trim() } : {}),
      ...(photoKeys ? { photoKeys } : {}),
      ...(patch.available != null ? { available: patch.available } : {}),
    });
    return this.withProductUrls(updated!);
  }

  async removeProduct(ownerUserId: string, productId: string): Promise<{ removed: boolean }> {
    const v = await this.mustOwn(ownerUserId);
    const p = await this.products.findById(productId);
    if (!p || p.vendorId !== v.id) throw new NotFoundException('Product not found');
    await this.products.remove(productId);
    return { removed: true };
  }

  async requestProductPhotoUpload(ownerUserId: string, contentType: string, sizeBytes: number): Promise<{ uploadUrl: string; key: string }> {
    const v = await this.mustOwn(ownerUserId);
    return this.presignImage(`vendor-product/${v.id}`, contentType, sizeBytes);
  }

  // ---------- helpers ----------
  private async presignImage(prefix: string, contentType: string, sizeBytes: number): Promise<{ uploadUrl: string; key: string }> {
    const ext = IMAGE_EXT[contentType];
    if (!ext) throw new BadRequestException('Unsupported image format');
    if (!Number.isInteger(sizeBytes) || sizeBytes <= 0) throw new BadRequestException('Invalid image size');
    if (sizeBytes > MAX_IMAGE_BYTES) throw new BadRequestException('Image is too large');
    const key = `${prefix}/${cryptoRandom()}.${ext}`;
    return this.store.presignPut(key, contentType, LOGO_UPLOAD_TTL);
  }

  private async withLogoUrl(v: Vendor): Promise<Vendor> {
    if (!v.logoKey) return v;
    const { logoKey, ...rest } = v;
    try { return { ...rest, logoUrl: await this.store.signedGetUrl(logoKey, ASSET_VIEW_TTL) }; }
    catch { return rest; }
  }

  private async withProductUrls(p: Product): Promise<Product> {
    if (!p.photoKeys?.length) return { ...p, photoKeys: [] };
    const urls: string[] = [];
    for (const k of p.photoKeys) {
      try { urls.push(await this.store.signedGetUrl(k, ASSET_VIEW_TTL)); } catch { /* skip a failed sign */ }
    }
    const { photoKeys, ...rest } = p;
    return { ...rest, photoKeys: [], photoUrls: urls };
  }
}

function cryptoRandom(): string {
  // Node's crypto.randomUUID via globalThis (avoids an extra import; available on Node 18+).
  return (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

/** Public browse view: never leak the vendor's bank account, owner id, or moderation notes. */
function stripPrivate(v: Vendor): Vendor {
  const { account, ownerUserId, rejectionReason, ...rest } = v;
  void account; void ownerUserId; void rejectionReason;
  return rest as Vendor;
}
