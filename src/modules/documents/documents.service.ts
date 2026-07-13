import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.validation.js';
import {
  documentOnboardingStatus, documentsClearRider, requiredDocuments, specFor,
  type CatalogContext, type DocumentStateOrMissing, type DocumentType, type OnboardingStatus, type VehicleTrack,
} from './domain/document-catalog.js';
import { sortReviewQueue, type QueueStatus } from './domain/review-queue.js';
import { isValidLegalName, isValidPlate, isValidVehicleColor, normalizePlate } from './domain/rider-profile.js';
import {
  DOCUMENT_REPO, DOCUMENT_STORE, type DocumentRecord, type DocumentRepo, type DocumentStore, type RiderProfile,
} from './ports.js';
import { NotificationsService } from '../notifications/notifications.service.js';

const UPLOAD_URL_TTL_SECONDS = 300;   // presigned PUT is valid for 5 minutes
const VIEW_URL_TTL_SECONDS = 120;     // signed GET (reviewer previews) valid for 2 minutes
const ALLOWED_CONTENT = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);

export interface ChecklistItem {
  type: DocumentType;
  label: string;
  required: boolean;
  expires: boolean;
  status: DocumentStateOrMissing;
  rejectionReason?: string;
  expiresAt?: number;
}

@Injectable()
export class DocumentsService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(DOCUMENT_REPO) private readonly repo: DocumentRepo,
    @Inject(DOCUMENT_STORE) private readonly store: DocumentStore,
    private readonly notify: NotificationsService,
  ) {}

  private ctx(): CatalogContext {
    return { city: this.env.LAUNCH_CITY, requireGuarantor: this.env.REQUIRE_GUARANTOR };
  }

  /** Choose (or change) the rider's vehicle track — decides which documents are required. */
  async setTrack(riderId: string, track: VehicleTrack): Promise<{ track: VehicleTrack }> {
    await this.repo.setTrack(riderId, track);
    return { track };
  }

  /**
   * The latest state per document type for a rider, with expiry applied: a document whose
   * expiresAt has passed is reported as EXPIRED regardless of its stored status.
   */
  private async latestStateByType(riderId: string, now: number): Promise<Map<DocumentType, DocumentStateOrMissing>> {
    const docs = await this.repo.listByRider(riderId);
    const latest = new Map<DocumentType, DocumentRecord>();
    for (const d of docs) {
      const prev = latest.get(d.type);
      if (!prev || d.version > prev.version) latest.set(d.type, d);
    }
    const out = new Map<DocumentType, DocumentStateOrMissing>();
    for (const [type, d] of latest) {
      const expired = d.expiresAt !== undefined && d.expiresAt <= now && d.status === 'APPROVED';
      out.set(type, expired ? 'EXPIRED' : d.status);
    }
    return out;
  }

  /** Rider-facing checklist + overall onboarding status for their chosen track. */
  async checklist(riderId: string): Promise<{ track: VehicleTrack | null; onboarding: OnboardingStatus | 'NO_TRACK'; items: ChecklistItem[] }> {
    const track = await this.repo.getTrack(riderId);
    if (!track) return { track: null, onboarding: 'NO_TRACK', items: [] };

    const required = requiredDocuments(track, this.ctx());
    const stateByType = await this.latestStateByType(riderId, Date.now());
    const docs = await this.repo.listByRider(riderId);
    const latestReason = new Map<DocumentType, { reason?: string; expiresAt?: number }>();
    for (const d of docs) latestReason.set(d.type, { reason: d.rejectionReason, expiresAt: d.expiresAt });

    const items: ChecklistItem[] = required.map((type) => ({
      type,
      label: specFor(type)?.label ?? type,
      required: true,
      expires: specFor(type)?.expires ?? false,
      status: stateByType.get(type) ?? 'MISSING',
      ...(latestReason.get(type)?.reason ? { rejectionReason: latestReason.get(type)!.reason } : {}),
      ...(latestReason.get(type)?.expiresAt ? { expiresAt: latestReason.get(type)!.expiresAt } : {}),
    }));

    const onboarding = documentOnboardingStatus(
      required,
      Object.fromEntries(stateByType) as Partial<Record<DocumentType, DocumentStateOrMissing>>,
    );
    return { track, onboarding, items };
  }

  /**
   * Create a document record (status SUBMITTED) and hand back a one-time presigned PUT URL. The
   * client uploads the image straight to storage under that URL. The document type must be part of
   * the rider's required set for their chosen track (rejects arbitrary types), and expiring
   * documents must carry a future expiry date.
   */
  async requestUpload(
    riderId: string,
    input: { type: DocumentType; contentType: string; issuedAt?: number; expiresAt?: number },
  ): Promise<{ documentId: string; uploadUrl: string }> {
    if (!ALLOWED_CONTENT.has(input.contentType)) throw new BadRequestException('Unsupported file type');
    const track = await this.repo.getTrack(riderId);
    if (!track) throw new BadRequestException('Choose your vehicle type first');
    const required = requiredDocuments(track, this.ctx());
    if (!required.includes(input.type)) throw new BadRequestException('This document is not required for your vehicle');

    const spec = specFor(input.type);
    if (spec?.expires) {
      if (!input.expiresAt) throw new BadRequestException('This document needs an expiry date');
      if (input.expiresAt <= Date.now()) throw new BadRequestException('The expiry date must be in the future');
    }

    const version = (await this.nextVersion(riderId, input.type));
    const key = `riders/${riderId}/${input.type}/${version}-${randomUUID()}`;
    const { uploadUrl } = await this.store.presignPut(key, input.contentType, UPLOAD_URL_TTL_SECONDS);

    const record = await this.repo.add({
      riderId, track, type: input.type, fileKey: key, status: 'SUBMITTED', version,
      ...(input.issuedAt ? { issuedAt: input.issuedAt } : {}),
      ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
    });
    return { documentId: record.id, uploadUrl };
  }

  private async nextVersion(riderId: string, type: DocumentType): Promise<number> {
    const docs = await this.repo.listByRider(riderId);
    const max = docs.filter((d) => d.type === type).reduce((m, d) => Math.max(m, d.version), 0);
    return max + 1;
  }

  /** A rider may fetch a short-lived preview URL for one of their own documents. */
  async ownDocumentUrl(riderId: string, documentId: string): Promise<{ url: string }> {
    const doc = await this.repo.findById(documentId);
    if (!doc) throw new NotFoundException('Document not found');
    if (doc.riderId !== riderId) throw new ForbiddenException();
    return { url: await this.store.signedGetUrl(doc.fileKey, VIEW_URL_TTL_SECONDS) };
  }

  // ---- Onboarding computation (shared by rider checklist + admin) ----

  private async onboardingFor(riderId: string, now: number): Promise<{ track: VehicleTrack | null; status: QueueStatus; oldestPendingAt: number }> {
    const track = await this.repo.getTrack(riderId);
    if (!track) return { track: null, status: 'NO_TRACK', oldestPendingAt: Number.MAX_SAFE_INTEGER };
    const required = requiredDocuments(track, this.ctx());
    const stateByType = await this.latestStateByType(riderId, now);
    const status = documentOnboardingStatus(
      required,
      Object.fromEntries(stateByType) as Partial<Record<DocumentType, DocumentStateOrMissing>>,
    );
    // Oldest still-awaiting-review document, so the queue can order by wait time.
    const docs = await this.repo.listByRider(riderId);
    const pending = docs.filter((d) => d.status === 'SUBMITTED' || d.status === 'UNDER_REVIEW').map((d) => d.createdAt);
    return { track, status, oldestPendingAt: pending.length ? Math.min(...pending) : Number.MAX_SAFE_INTEGER };
  }

  /** True only when every required document is approved — the gate for going online / accepting jobs. */
  async isRiderCleared(riderId: string): Promise<boolean> {
    const { status } = await this.onboardingFor(riderId, Date.now());
    return status !== 'NO_TRACK' && documentsClearRider(status);
  }

  // ---- Admin / reviewer ----

  /** The reviewer queue: every onboarding rider with their track + status, neediest first. */
  async reviewQueue(): Promise<Array<{ riderId: string; track: VehicleTrack | null; status: QueueStatus; oldestPendingAt: number }>> {
    const now = Date.now();
    const ids = await this.repo.listRiderIds();
    const entries = await Promise.all(ids.map(async (riderId) => ({ riderId, ...(await this.onboardingFor(riderId, now)) })));
    return sortReviewQueue(entries);
  }

  /** Full document detail for one rider, each with a short-lived signed preview URL. */
  async riderDetail(riderId: string): Promise<{
    riderId: string; track: VehicleTrack | null; status: QueueStatus; profile: RiderProfile;
    documents: Array<{ id: string; type: DocumentType; label: string; status: string; version: number; rejectionReason?: string; issuedAt?: number; expiresAt?: number; previewUrl: string }>;
  }> {
    const now = Date.now();
    const { track, status } = await this.onboardingFor(riderId, now);
    const profile = await this.repo.getProfile(riderId);
    const docs = await this.repo.listByRider(riderId);
    // Latest version per type only (older versions stay in the audit trail but aren't shown).
    const latest = new Map<DocumentType, DocumentRecord>();
    for (const d of docs) { const p = latest.get(d.type); if (!p || d.version > p.version) latest.set(d.type, d); }
    const documents = await Promise.all([...latest.values()].map(async (d) => ({
      id: d.id, type: d.type, label: specFor(d.type)?.label ?? d.type, status: d.status, version: d.version,
      ...(d.rejectionReason ? { rejectionReason: d.rejectionReason } : {}),
      ...(d.issuedAt ? { issuedAt: d.issuedAt } : {}),
      ...(d.expiresAt ? { expiresAt: d.expiresAt } : {}),
      previewUrl: await this.store.signedGetUrl(d.fileKey, VIEW_URL_TTL_SECONDS),
    })));
    return { riderId, track, status, profile, documents };
  }

  async approveDocument(documentId: string, reviewerId: string): Promise<{ riderStatus: QueueStatus }> {
    const doc = await this.mustFindDoc(documentId);
    await this.repo.updateStatus(documentId, { status: 'APPROVED', reviewedBy: reviewerId, reviewedAt: Date.now() });
    const after = await this.onboardingFor(doc.riderId, Date.now());
    if (after.status === 'APPROVED') {
      await this.notify.record(doc.riderId, { title: 'You’re verified', body: 'All your documents are approved — you can go online and start delivering.', urgent: true });
    } else {
      await this.notify.record(doc.riderId, { title: 'Document approved', body: `Your ${specFor(doc.type)?.label ?? 'document'} was approved.` });
    }
    return { riderStatus: after.status };
  }

  async rejectDocument(documentId: string, reviewerId: string, reason: string): Promise<{ riderStatus: QueueStatus }> {
    const doc = await this.mustFindDoc(documentId);
    await this.repo.updateStatus(documentId, { status: 'REJECTED', rejectionReason: reason, reviewedBy: reviewerId, reviewedAt: Date.now() });
    await this.notify.record(doc.riderId, {
      title: 'Document needs attention',
      body: `Your ${specFor(doc.type)?.label ?? 'document'} was rejected: ${reason}. Please re-upload it.`,
      urgent: true,
    });
    const after = await this.onboardingFor(doc.riderId, Date.now());
    return { riderStatus: after.status };
  }

  private async mustFindDoc(documentId: string): Promise<DocumentRecord> {
    const doc = await this.repo.findById(documentId);
    if (!doc) throw new NotFoundException('Document not found');
    return doc;
  }

  // ---- Rider profile (identity + vehicle shown to customers) ----

  getRiderProfile(riderId: string): Promise<RiderProfile> {
    return this.repo.getProfile(riderId);
  }

  /** Rider sets their legal name / plate / colour. Changing the name resets verification. */
  async updateRiderProfile(
    riderId: string,
    input: { legalName?: string; vehiclePlate?: string; vehicleColor?: string },
  ): Promise<RiderProfile> {
    const patch: { legalName?: string; vehiclePlate?: string; vehicleColor?: string } = {};
    if (input.legalName !== undefined) {
      if (!isValidLegalName(input.legalName)) throw new BadRequestException('Enter your name exactly as it appears on your ID');
      patch.legalName = input.legalName.trim();
    }
    if (input.vehiclePlate !== undefined) {
      if (!isValidPlate(input.vehiclePlate)) throw new BadRequestException('Enter a valid vehicle plate number');
      patch.vehiclePlate = normalizePlate(input.vehiclePlate);
    }
    if (input.vehicleColor !== undefined) {
      if (!isValidVehicleColor(input.vehicleColor)) throw new BadRequestException('Choose a valid vehicle colour');
      patch.vehicleColor = input.vehicleColor;
    }
    await this.repo.setProfile(riderId, patch);
    return this.repo.getProfile(riderId);
  }

  /** Admin confirms the rider's legal name matches their Gov ID. */
  setRiderNameVerified(riderId: string, verified: boolean): Promise<void> {
    return this.repo.setNameVerified(riderId, verified);
  }

  /** The rider details a customer sees once a rider is assigned to their job. */
  async riderSummaryFor(riderId: string): Promise<{
    name?: string; nameVerified: boolean; vehicleType: VehicleTrack | null; vehiclePlate?: string; vehicleColor?: string;
  }> {
    const p = await this.repo.getProfile(riderId);
    return {
      nameVerified: p.nameVerified,
      vehicleType: p.track,
      ...(p.legalName ? { name: p.legalName } : {}),
      ...(p.vehiclePlate ? { vehiclePlate: p.vehiclePlate } : {}),
      ...(p.vehicleColor ? { vehicleColor: p.vehicleColor } : {}),
    };
  }
}
