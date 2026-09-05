import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service.js';
import type {
  NewProduct, NewVendor, Product, ProductPatch, ProductRepo, Vendor, VendorPatch, VendorRepo, VendorStatus,
} from '../ports.js';

// The generated Prisma client can lag the schema where `prisma generate` hasn't run against the newest
// models (offline CI) — so the `vendor`/`product` delegates may not exist on the typed client yet. We
// reach them through a loose delegate shape; at runtime the real generated delegates are used. Writes
// use `never` so the data shape type-checks both there and in prod.
type PrismaWrite = never;
interface AnyDelegate {
  create(a: unknown): Promise<unknown>;
  findUnique(a: unknown): Promise<unknown>;
  findMany(a: unknown): Promise<unknown>;
  update(a: unknown): Promise<unknown>;
  delete(a: unknown): Promise<unknown>;
}
const vendorDelegate = (db: PrismaService): AnyDelegate => (db as unknown as { vendor: AnyDelegate }).vendor;
const productDelegate = (db: PrismaService): AnyDelegate => (db as unknown as { product: AnyDelegate }).product;

interface VRow {
  id: string; ownerUserId: string; businessName: string; rcNumber: string | null; category: string | null;
  area: string | null; description: string | null; logoKey: string | null; shopLat: number | null; shopLng: number | null; status: VendorStatus;
  bankCode: string | null; accountNumber: string | null; accountName: string | null; accountVerified: boolean;
  rejectionReason: string | null; approvedAt: Date | null; createdAt: Date;
}
function toVendor(r: VRow): Vendor {
  return {
    id: r.id, ownerUserId: r.ownerUserId, businessName: r.businessName, status: r.status,
    accountVerified: r.accountVerified, createdAt: r.createdAt.getTime(),
    ...(r.rcNumber ? { rcNumber: r.rcNumber } : {}),
    ...(r.category ? { category: r.category } : {}),
    ...(r.area ? { area: r.area } : {}),
    ...(r.description ? { description: r.description } : {}),
    ...(r.logoKey ? { logoKey: r.logoKey } : {}),
    ...(r.shopLat != null ? { shopLat: r.shopLat } : {}),
    ...(r.shopLng != null ? { shopLng: r.shopLng } : {}),
    ...(r.bankCode && r.accountNumber && r.accountName
      ? { account: { bankCode: r.bankCode, accountNumber: r.accountNumber, accountName: r.accountName } } : {}),
    ...(r.rejectionReason ? { rejectionReason: r.rejectionReason } : {}),
    ...(r.approvedAt ? { approvedAt: r.approvedAt.getTime() } : {}),
  };
}

@Injectable()
export class PrismaVendorRepo implements VendorRepo {
  constructor(private readonly db: PrismaService) {}

  async create(n: NewVendor): Promise<Vendor> {
    const row = await vendorDelegate(this.db).create({ data: {
      ownerUserId: n.ownerUserId, businessName: n.businessName,
      rcNumber: n.rcNumber ?? null, category: n.category ?? null, area: n.area ?? null, description: n.description ?? null,
    } as PrismaWrite });
    return toVendor(row as unknown as VRow);
  }
  async findById(id: string): Promise<Vendor | null> {
    const row = await vendorDelegate(this.db).findUnique({ where: { id } });
    return row ? toVendor(row as unknown as VRow) : null;
  }
  async findByOwner(ownerUserId: string): Promise<Vendor | null> {
    const row = await vendorDelegate(this.db).findUnique({ where: { ownerUserId } as PrismaWrite });
    return row ? toVendor(row as unknown as VRow) : null;
  }
  async update(id: string, patch: VendorPatch): Promise<Vendor | null> {
    const data: Record<string, unknown> = {};
    if (patch.businessName != null) data.businessName = patch.businessName;
    if (patch.rcNumber != null) data.rcNumber = patch.rcNumber || null;
    if (patch.category != null) data.category = patch.category || null;
    if (patch.area != null) data.area = patch.area || null;
    if (patch.description != null) data.description = patch.description || null;
    if (patch.logoKey != null) data.logoKey = patch.logoKey;
    if (patch.shopLat != null) data.shopLat = patch.shopLat;
    if (patch.shopLng != null) data.shopLng = patch.shopLng;
    if (patch.status != null) data.status = patch.status;
    if (patch.account !== undefined) {
      data.bankCode = patch.account?.bankCode ?? null;
      data.accountNumber = patch.account?.accountNumber ?? null;
      data.accountName = patch.account?.accountName ?? null;
    }
    if (patch.accountVerified != null) data.accountVerified = patch.accountVerified;
    if (patch.rejectionReason !== undefined) data.rejectionReason = patch.rejectionReason ?? null;
    if (patch.approvedAt !== undefined) data.approvedAt = patch.approvedAt ? new Date(patch.approvedAt) : null;
    const row = await vendorDelegate(this.db).update({ where: { id }, data: data as PrismaWrite });
    return toVendor(row as unknown as VRow);
  }
  async listByStatus(status: VendorStatus, limit: number): Promise<Vendor[]> {
    const rows = await vendorDelegate(this.db).findMany({ where: { status } as PrismaWrite, orderBy: { createdAt: 'asc' }, take: limit });
    return (rows as unknown as VRow[]).map(toVendor);
  }
  async listApproved(limit: number): Promise<Vendor[]> {
    const rows = await vendorDelegate(this.db).findMany({ where: { status: 'APPROVED' } as PrismaWrite, orderBy: { createdAt: 'desc' }, take: limit });
    return (rows as unknown as VRow[]).map(toVendor);
  }
}

interface PRow {
  id: string; vendorId: string; name: string; priceMinor: number; description: string | null;
  photoKeys: string[]; available: boolean; createdAt: Date;
}
function toProduct(r: PRow): Product {
  return {
    id: r.id, vendorId: r.vendorId, name: r.name, priceMinor: r.priceMinor,
    photoKeys: r.photoKeys ?? [], available: r.available, createdAt: r.createdAt.getTime(),
    ...(r.description ? { description: r.description } : {}),
  };
}

@Injectable()
export class PrismaProductRepo implements ProductRepo {
  constructor(private readonly db: PrismaService) {}

  async create(n: NewProduct): Promise<Product> {
    const row = await productDelegate(this.db).create({ data: {
      vendorId: n.vendorId, name: n.name, priceMinor: n.priceMinor,
      description: n.description ?? null, photoKeys: n.photoKeys ?? [], available: n.available ?? true,
    } as PrismaWrite });
    return toProduct(row as unknown as PRow);
  }
  async findById(id: string): Promise<Product | null> {
    const row = await productDelegate(this.db).findUnique({ where: { id } });
    return row ? toProduct(row as unknown as PRow) : null;
  }
  async listByVendor(vendorId: string, opts?: { availableOnly?: boolean }): Promise<Product[]> {
    const rows = await productDelegate(this.db).findMany({
      where: { vendorId, ...(opts?.availableOnly ? { available: true } : {}) } as PrismaWrite,
      orderBy: { createdAt: 'desc' },
    });
    return (rows as unknown as PRow[]).map(toProduct);
  }
  async update(id: string, patch: ProductPatch): Promise<Product | null> {
    const data: Record<string, unknown> = {};
    if (patch.name != null) data.name = patch.name;
    if (patch.priceMinor != null) data.priceMinor = patch.priceMinor;
    if (patch.description != null) data.description = patch.description || null;
    if (patch.photoKeys != null) data.photoKeys = patch.photoKeys;
    if (patch.available != null) data.available = patch.available;
    const row = await productDelegate(this.db).update({ where: { id }, data: data as PrismaWrite });
    return toProduct(row as unknown as PRow);
  }
  async remove(id: string): Promise<void> {
    await productDelegate(this.db).delete({ where: { id } });
  }
}
