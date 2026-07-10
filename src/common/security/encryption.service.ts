import { Injectable, Inject } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.validation.js';

/**
 * Authenticated encryption (AES-256-GCM) for PII / bank / KYC data at rest.
 * Key is a base64-encoded 32-byte key sourced from the vault (DATA_ENCRYPTION_KEY).
 * Output format: base64( iv(12) | authTag(16) | ciphertext ).
 */
@Injectable()
export class EncryptionService {
  private readonly key: Buffer;

  constructor(@Inject(ENV) env: Env) {
    const key = Buffer.from(env.DATA_ENCRYPTION_KEY, 'base64');
    if (key.length !== 32) {
      throw new Error('DATA_ENCRYPTION_KEY must be a base64-encoded 32-byte key');
    }
    this.key = key;
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return Buffer.concat([iv, authTag, ciphertext]).toString('base64');
  }

  decrypt(payload: string): string {
    const buf = Buffer.from(payload, 'base64');
    if (buf.length < 28) throw new Error('Ciphertext too short');
    const iv = buf.subarray(0, 12);
    const authTag = buf.subarray(12, 28);
    const ciphertext = buf.subarray(28);
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  }
}
