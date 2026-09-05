import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type {
  NewProduct, NewVendor, Product, ProductPatch, ProductRepo, Vendor, VendorPatch, VendorRepo, VendorStatus,
} from '../ports.js';

// DEV ONLY. Swapped for the Postgres-backed repos when DB_DRIVER=postgres.
@Injectable()
export class InMemoryVendorRepo implements VendorRepo {
  private m = new Map<string, Vendor>();

  async create(n: NewVendor): Promise<Vendor> {
    const v: Vendor = {
      id: randomUUID(), ownerUserId: n.ownerUserId, businessName: n.businessName,
      ...(n.rcNumber ? { rcNumber: n.rcNumber } : {}),
      ...(n.category ? { category: n.category } : {}),
      ...(n.area ? { area: n.area } : {}),
      ...(n.description ? { description: n.description } : {}),
      status: 'PENDING', accountVerified: false, createdAt: Date.now(),
    };
    this.m.set(v.id, v);
    return v;
  }
  async findById(id: string): Promise<Vendor | null> { return this.m.get(id) ?? null; }
  async findByOwner(ownerUserId: string): Promise<Vendor | null> {
    return [...this.m.values()].find((v) => v.ownerUserId === ownerUserId) ?? null;
  }
  async update(id: string, patch: VendorPatch): Promise<Vendor | null> {
    const v = this.m.get(id);
    if (!v) return null;
    const next: Vendor = { ...v };
    if (patch.businessName != null) next.businessName = patch.businessName;
    if (patch.rcNumber != null) next.rcNumber = patch.rcNumber || undefined;
    if (patch.category != null) next.category = patch.category || undefined;
    if (patch.area != null) next.area = patch.area || undefined;
    if (patch.description != null) next.description = patch.description || undefined;
    if (patch.logoKey != null) next.logoKey = patch.logoKey;
    if (patch.shopLat != null) next.shopLat = patch.shopLat;
    if (patch.shopLng != null) next.shopLng = patch.shopLng;
    if (patch.status != null) next.status = patch.status;
    if (patch.account !== undefined) next.account = patch.account ?? undefined;
    if (patch.accountVerified != null) next.accountVerified = patch.accountVerified;
    if (patch.rejectionReason !== undefined) next.rejectionReason = patch.rejectionReason ?? undefined;
    if (patch.approvedAt !== undefined) next.approvedAt = patch.approvedAt ?? undefined;
    this.m.set(id, next);
    return next;
  }
  async listByStatus(status: VendorStatus, limit: number): Promise<Vendor[]> {
    return [...this.m.values()].filter((v) => v.status === status).sort((a, b) => a.createdAt - b.createdAt).slice(0, limit);
  }
  async listApproved(limit: number): Promise<Vendor[]> {
    return [...this.m.values()].filter((v) => v.status === 'APPROVED').sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
  }
}

@Injectable()
export class InMemoryProductRepo implements ProductRepo {
  private m = new Map<string, Product>();

  async create(n: NewProduct): Promise<Product> {
    const p: Product = {
      id: randomUUID(), vendorId: n.vendorId, name: n.name, priceMinor: n.priceMinor,
      ...(n.description ? { description: n.description } : {}),
      photoKeys: n.photoKeys ?? [], available: n.available ?? true, createdAt: Date.now(),
    };
    this.m.set(p.id, p);
    return p;
  }
  async findById(id: string): Promise<Product | null> { return this.m.get(id) ?? null; }
  async listByVendor(vendorId: string, opts?: { availableOnly?: boolean }): Promise<Product[]> {
    return [...this.m.values()]
      .filter((p) => p.vendorId === vendorId && (!opts?.availableOnly || p.available))
      .sort((a, b) => b.createdAt - a.createdAt);
  }
  async update(id: string, patch: ProductPatch): Promise<Product | null> {
    const p = this.m.get(id);
    if (!p) return null;
    const next: Product = { ...p };
    if (patch.name != null) next.name = patch.name;
    if (patch.priceMinor != null) next.priceMinor = patch.priceMinor;
    if (patch.description != null) next.description = patch.description || undefined;
    if (patch.photoKeys != null) next.photoKeys = patch.photoKeys;
    if (patch.available != null) next.available = patch.available;
    this.m.set(id, next);
    return next;
  }
  async remove(id: string): Promise<void> { this.m.delete(id); }
}
