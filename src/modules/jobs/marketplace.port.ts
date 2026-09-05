/**
 * Read-only view of the vendor catalog that JobsService needs to build a marketplace order — kept as a
 * port so Jobs doesn't hard-depend on VendorsService (bound to it in the module). Product prices are
 * ALWAYS read here (server-authoritative), never trusted from the checkout body.
 */
export interface MarketplaceVendorView {
  id: string;
  businessName: string;
  area?: string;
  status: string;
  shopLat?: number;
  shopLng?: number;
  account?: { bankCode: string; accountNumber: string; accountName: string };
}
export interface MarketplaceProductView {
  id: string;
  vendorId: string;
  name: string;
  priceMinor: number;
  available: boolean;
}
export interface MarketplaceVendorSource {
  getForOrder(vendorId: string): Promise<MarketplaceVendorView>;
  findProduct(productId: string): Promise<MarketplaceProductView | null>;
  /** The vendor id owned by this user, if any (for the vendor's own order list). */
  findVendorIdByOwner(ownerUserId: string): Promise<string | null>;
}
export const MARKETPLACE_VENDOR_SOURCE = Symbol('MARKETPLACE_VENDOR_SOURCE');
