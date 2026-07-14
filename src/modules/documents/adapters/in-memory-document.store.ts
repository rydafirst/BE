import { Injectable } from '@nestjs/common';
import type { DocumentStore } from '../ports.js';

/**
 * DEV/tests object store. It does not actually hold bytes — it hands back deterministic local URLs
 * so the flow is exercisable end-to-end without a real bucket. The Cloudflare R2 (S3-compatible)
 * adapter, selected in prod by env, is the real implementation and is a drop-in for this port.
 */
@Injectable()
export class InMemoryDocumentStore implements DocumentStore {
  async presignPut(key: string, _contentType: string, _ttlSeconds: number, _contentLength?: number): Promise<{ uploadUrl: string; key: string }> {
    return { uploadUrl: `memory://upload/${key}`, key };
  }
  async signedGetUrl(key: string, _ttlSeconds: number): Promise<string> {
    return `memory://get/${key}`;
  }
  async remove(_key: string): Promise<void> {
    /* no-op in memory */
  }
}
