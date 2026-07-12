import type { DocumentStatus, DocumentType, VehicleTrack } from './domain/document-catalog.js';

/** A persisted rider document (one row per upload; re-uploads bump `version`). */
export interface DocumentRecord {
  id: string;
  riderId: string;
  track: VehicleTrack;
  type: DocumentType;
  fileKey: string;          // opaque key into the object store — never a public URL
  status: DocumentStatus;
  rejectionReason?: string;
  issuedAt?: number;        // epoch ms (expiring documents)
  expiresAt?: number;       // epoch ms — drives the expiry sweep (Phase C)
  version: number;
  reviewedBy?: string;
  reviewedAt?: number;
  createdAt: number;
}

export interface NewDocument {
  riderId: string;
  track: VehicleTrack;
  type: DocumentType;
  fileKey: string;
  status: DocumentStatus;
  issuedAt?: number;
  expiresAt?: number;
  version: number;
}

/** Records + the rider's chosen vehicle track (the onboarding aggregate's store). */
export interface DocumentRepo {
  add(doc: NewDocument): Promise<DocumentRecord>;
  findById(id: string): Promise<DocumentRecord | null>;
  listByRider(riderId: string): Promise<DocumentRecord[]>;
  updateStatus(id: string, patch: Partial<Pick<DocumentRecord,
    'status' | 'rejectionReason' | 'reviewedBy' | 'reviewedAt'>>): Promise<DocumentRecord | null>;
  setTrack(riderId: string, track: VehicleTrack): Promise<void>;
  getTrack(riderId: string): Promise<VehicleTrack | null>;
  /** Every rider who has begun onboarding (chosen a track and/or uploaded a document). */
  listRiderIds(): Promise<string[]>;
}
export const DOCUMENT_REPO = Symbol('DOCUMENT_REPO');

/**
 * Object storage for the document images. Uploads go **direct to storage** via a short-lived
 * presigned PUT URL (the API never proxies the bytes); reads are served via short-lived signed GET
 * URLs to authenticated reviewers only. No object is ever public.
 */
export interface DocumentStore {
  /** A one-time upload URL + the key the object will live under. */
  presignPut(key: string, contentType: string, ttlSeconds: number): Promise<{ uploadUrl: string; key: string }>;
  /** A short-lived read URL for a stored object. */
  signedGetUrl(key: string, ttlSeconds: number): Promise<string>;
  remove(key: string): Promise<void>;
}
export const DOCUMENT_STORE = Symbol('DOCUMENT_STORE');
