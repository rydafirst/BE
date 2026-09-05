export type VendorStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUSPENDED';

/** A name-verified BUSINESS payout account (never personal) — resolved via NIP name-enquiry. */
export interface VendorBusinessAccount { bankCode: string; accountNumber: string; accountName: string }

export interface Vendor {
  id: string;
  ownerUserId: string;
  businessName: string;
  rcNumber?: string;      // CAC/RC number, if supplied
  category?: string;
  area?: string;
  description?: string;
  logoKey?: string;       // internal object-store key (never returned to a client)
  logoUrl?: string;       // short-lived signed URL, resolved at read time
  shopLat?: number;       // shop location — prices vendor→customer delivery on marketplace orders
  shopLng?: number;
  status: VendorStatus;
  account?: VendorBusinessAccount;
  accountVerified: boolean;
  rejectionReason?: string;
  approvedAt?: number;
  createdAt: number;
}
export interface NewVendor {
  ownerUserId: string;
  businessName: string;
  rcNumber?: string;
  category?: string;
  area?: string;
  description?: string;
}
/** Fields the repo can patch (profile edits + status/account transitions decided by the service). */
export interface VendorPatch {
  businessName?: string;
  rcNumber?: string;
  category?: string;
  area?: string;
  description?: string;
  logoKey?: string;
  shopLat?: number;
  shopLng?: number;
  status?: VendorStatus;
  account?: VendorBusinessAccount | null;
  accountVerified?: boolean;
  rejectionReason?: string | null;
  approvedAt?: number | null;
}

export interface VendorRepo {
  create(v: NewVendor): Promise<Vendor>;
  findById(id: string): Promise<Vendor | null>;
  findByOwner(ownerUserId: string): Promise<Vendor | null>;
  update(id: string, patch: VendorPatch): Promise<Vendor | null>;
  listByStatus(status: VendorStatus, limit: number): Promise<Vendor[]>;
  listApproved(limit: number): Promise<Vendor[]>;
}
export const VENDOR_REPO = Symbol('VENDOR_REPO');

export interface Product {
  id: string;
  vendorId: string;
  name: string;
  priceMinor: number;
  description?: string;
  photoKeys: string[];    // internal object-store keys
  photoUrls?: string[];   // resolved signed URLs at read time
  available: boolean;
  createdAt: number;
}
export interface NewProduct {
  vendorId: string;
  name: string;
  priceMinor: number;
  description?: string;
  photoKeys?: string[];
  available?: boolean;
}
export interface ProductPatch {
  name?: string;
  priceMinor?: number;
  description?: string;
  photoKeys?: string[];
  available?: boolean;
}
export interface ProductRepo {
  create(p: NewProduct): Promise<Product>;
  findById(id: string): Promise<Product | null>;
  listByVendor(vendorId: string, opts?: { availableOnly?: boolean }): Promise<Product[]>;
  update(id: string, patch: ProductPatch): Promise<Product | null>;
  remove(id: string): Promise<void>;
}
export const PRODUCT_REPO = Symbol('PRODUCT_REPO');
