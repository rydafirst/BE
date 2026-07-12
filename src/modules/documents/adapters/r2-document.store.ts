import { Inject, Injectable } from '@nestjs/common';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { ENV } from '../../../config/config.module.js';
import type { Env } from '../../../config/env.validation.js';
import type { DocumentStore } from '../ports.js';

/**
 * Cloudflare R2 (S3-compatible) document store. Objects are **private**; the app never exposes a
 * public URL. Uploads go direct to R2 via a short-lived presigned PUT (the API never proxies the
 * bytes); reviewer previews use a short-lived presigned GET. Credentials come from validated env
 * (the app refuses to boot with DOCUMENT_STORE_DRIVER=r2 unless all R2_* vars are present).
 */
@Injectable()
export class R2DocumentStore implements DocumentStore {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(@Inject(ENV) env: Env) {
    this.bucket = env.R2_BUCKET;
    this.client = new S3Client({
      region: 'auto',
      endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY },
    });
  }

  async presignPut(key: string, contentType: string, ttlSeconds: number): Promise<{ uploadUrl: string; key: string }> {
    const cmd = new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType });
    const uploadUrl = await getSignedUrl(this.client, cmd, { expiresIn: ttlSeconds });
    return { uploadUrl, key };
  }

  async signedGetUrl(key: string, ttlSeconds: number): Promise<string> {
    const cmd = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    return getSignedUrl(this.client, cmd, { expiresIn: ttlSeconds });
  }

  async remove(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}
