export interface CustomerPhotoSource {
  /** Short-lived signed URL for a customer's avatar (shown to their rider), or null if none. */
  photoUrl(userId: string): Promise<string | null>;
}
export const CUSTOMER_PHOTO = Symbol('CUSTOMER_PHOTO');
