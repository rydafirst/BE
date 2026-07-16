import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { DOCUMENT_STORE, type DocumentStore } from '../documents/ports.js';
import { USER_REPO, type UserRepository } from '../auth/ports.js';
import type { CustomerPhotoSource } from '../jobs/customer-photo.port.js';

const UPLOAD_TTL_SECONDS = 300;
const VIEW_TTL_SECONDS = 300;
const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_AVATAR_BYTES = 5 * 1024 * 1024; // 5 MB

/**
 * User profile avatars, stored in the same private object store as rider documents (never public;
 * reads go through short-lived signed URLs). One deterministic key per user, so a re-upload
 * overwrites the previous photo. Implements CustomerPhotoSource so the jobs module can show a
 * customer's photo to their assigned rider without depending on storage details.
 */
@Injectable()
export class AvatarService implements CustomerPhotoSource {
  constructor(
    @Inject(DOCUMENT_STORE) private readonly store: DocumentStore,
    @Inject(USER_REPO) private readonly users: UserRepository,
  ) {}

  private keyFor(userId: string): string { return `avatars/${userId}`; }

  /** Presigned one-time upload URL for the caller's own avatar; records the key on the user. */
  async requestUpload(userId: string, contentType: string, sizeBytes: number): Promise<{ uploadUrl: string }> {
    if (!ALLOWED.has(contentType)) throw new BadRequestException('Only JPEG, PNG or WebP images are allowed');
    if (!Number.isInteger(sizeBytes) || sizeBytes <= 0) throw new BadRequestException('Invalid image size');
    if (sizeBytes > MAX_AVATAR_BYTES) throw new BadRequestException('Image must be 5 MB or smaller');
    const key = this.keyFor(userId);
    // NOTE: we deliberately do NOT sign Content-Length into the presigned PUT. Doing so makes R2
    // reject the upload with 403 unless the client's body is byte-for-byte the size it declared,
    // and mobile image pickers re-compress on device (Android especially), so the reported
    // `sizeBytes` rarely matches the bytes actually sent. The 5 MB ceiling is still enforced above
    // from the declared size; avatars are private, per-user and overwrite-in-place, so an inexact
    // body size is not a security concern.
    const { uploadUrl } = await this.store.presignPut(key, contentType, UPLOAD_TTL_SECONDS);
    await this.users.setPhotoKey(userId, key);
    return { uploadUrl };
  }

  /** Signed view URL for a user's avatar, or null if they haven't set one. */
  async photoUrl(userId: string): Promise<string | null> {
    const key = await this.users.getPhotoKey(userId);
    if (!key) return null;
    return this.store.signedGetUrl(key, VIEW_TTL_SECONDS);
  }
}
