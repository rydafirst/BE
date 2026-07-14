import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { DOCUMENT_STORE, type DocumentStore } from '../documents/ports.js';
import { USER_REPO, type UserRepository } from '../auth/ports.js';
import type { CustomerPhotoSource } from '../jobs/customer-photo.port.js';

const UPLOAD_TTL_SECONDS = 300;
const VIEW_TTL_SECONDS = 300;
const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp']);

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
  async requestUpload(userId: string, contentType: string): Promise<{ uploadUrl: string }> {
    if (!ALLOWED.has(contentType)) throw new BadRequestException('Only JPEG, PNG or WebP images are allowed');
    const key = this.keyFor(userId);
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
