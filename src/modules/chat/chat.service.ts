import { randomUUID } from 'node:crypto';
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { JobsService } from '../jobs/jobs.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { DOCUMENT_STORE, type DocumentStore } from '../documents/ports.js';
import { sanitizeMessageBody } from './domain/message.js';
import { chatCounterparty, chatNotification } from './domain/notify.js';
import { MESSAGE_REPO, REPORT_REPO, type ChatMessage, type MessageRepo, type MessageReport, type ReportRepo } from './ports.js';

const HISTORY_LIMIT = 200;
const MAX_REASON_LEN = 300;

// Voice notes: short clips only, stored in the same private object store as documents/avatars and
// served via short-lived signed URLs. Common on-device encodings across iOS/Android and web recorders.
const AUDIO_UPLOAD_TTL = 300;
const AUDIO_VIEW_TTL = 3600;
const MAX_AUDIO_BYTES = 10 * 1024 * 1024; // ~10 MB — a few minutes of compressed voice
const AUDIO_EXT: Record<string, string> = {
  'audio/m4a': 'm4a', 'audio/x-m4a': 'm4a', 'audio/mp4': 'm4a', 'audio/aac': 'm4a',
  'audio/mpeg': 'mp3', 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/wav': 'wav',
};

// Photo attachments (e.g. a customer showing the rider exactly what to buy on an errand). Same private
// store + signed URLs as voice notes; only common still-image encodings are accepted.
const IMAGE_VIEW_TTL = 3600;
const MAX_IMAGE_BYTES = 15 * 1024 * 1024; // ~15 MB — a phone photo
const IMAGE_EXT: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heif',
};

/**
 * Rider–customer chat, scoped to a single job. Authorization is delegated to JobsService.getJob,
 * which throws unless the caller is that job's customer or assigned rider — so no third party can
 * ever read or post to a conversation they aren't part of.
 */
@Injectable()
export class ChatService {
  constructor(
    @Inject(MESSAGE_REPO) private readonly repo: MessageRepo,
    @Inject(REPORT_REPO) private readonly reports: ReportRepo,
    @Inject(DOCUMENT_STORE) private readonly store: DocumentStore,
    private readonly jobs: JobsService,
    private readonly notify: NotificationsService,
  ) {}

  async list(actorId: string, jobId: string): Promise<ChatMessage[]> {
    await this.jobs.getJob(actorId, jobId); // authorises (party-only) or throws
    return this.withAttachmentUrls(await this.repo.listForJob(jobId, HISTORY_LIMIT));
  }

  /**
   * Presigned one-time upload URL for a voice note the caller is about to send on this job. The key is
   * minted server-side under `chat-audio/<jobId>/…`, so when the client later posts a message quoting
   * that key we can verify it belongs to THIS conversation (a client can't attach an arbitrary object).
   */
  async requestAudioUpload(actorId: string, jobId: string, contentType: string, sizeBytes: number): Promise<{ uploadUrl: string; key: string }> {
    await this.jobs.getJob(actorId, jobId); // authorises (party-only) or throws
    const ext = AUDIO_EXT[contentType];
    if (!ext) throw new BadRequestException('Unsupported audio format');
    if (!Number.isInteger(sizeBytes) || sizeBytes <= 0) throw new BadRequestException('Invalid audio size');
    if (sizeBytes > MAX_AUDIO_BYTES) throw new BadRequestException('Voice note is too long');
    const key = `chat-audio/${jobId}/${randomUUID()}.${ext}`;
    // Content-Length is deliberately not signed in (mobile recorders re-encode; the ceiling above still
    // applies from the declared size, and clips are private, per-conversation objects).
    const { uploadUrl } = await this.store.presignPut(key, contentType, AUDIO_UPLOAD_TTL);
    return { uploadUrl, key };
  }

  /**
   * Presigned one-time upload URL for a photo the caller is about to send on this job. Same key-scoping
   * guarantee as voice notes: minted under `chat-image/<jobId>/…`, verified on post.
   */
  async requestImageUpload(actorId: string, jobId: string, contentType: string, sizeBytes: number): Promise<{ uploadUrl: string; key: string }> {
    await this.jobs.getJob(actorId, jobId); // authorises (party-only) or throws
    const ext = IMAGE_EXT[contentType];
    if (!ext) throw new BadRequestException('Unsupported image format');
    if (!Number.isInteger(sizeBytes) || sizeBytes <= 0) throw new BadRequestException('Invalid image size');
    if (sizeBytes > MAX_IMAGE_BYTES) throw new BadRequestException('Image is too large');
    const key = `chat-image/${jobId}/${randomUUID()}.${ext}`;
    const { uploadUrl } = await this.store.presignPut(key, contentType, AUDIO_UPLOAD_TTL);
    return { uploadUrl, key };
  }

  async post(actorId: string, jobId: string, rawBody: unknown, replyToId?: string, audio?: { key?: string; durationMs?: number }, imageKeyRaw?: string): Promise<ChatMessage> {
    const job = await this.jobs.getJob(actorId, jobId); // authorises (party-only) or throws

    // A voice note is a message whose attached key belongs to THIS job (minted by requestAudioUpload).
    const audioKey = (typeof audio?.key === 'string' && audio.key.startsWith(`chat-audio/${jobId}/`)) ? audio.key : undefined;
    const audioDurationMs = audioKey && Number.isFinite(audio?.durationMs) && (audio!.durationMs as number) > 0
      ? Math.min(Math.round(audio!.durationMs as number), 10 * 60_000) : undefined;
    // A photo is a message whose attached key belongs to THIS job (minted by requestImageUpload).
    const imageKey = (typeof imageKeyRaw === 'string' && imageKeyRaw.startsWith(`chat-image/${jobId}/`)) ? imageKeyRaw : undefined;

    // Text requires a body; an attachment (voice note or photo) may carry an optional caption or none.
    const hasAttachment = !!audioKey || !!imageKey;
    let body = '';
    try {
      if (!hasAttachment) body = sanitizeMessageBody(rawBody);
      else if (typeof rawBody === 'string' && rawBody.trim()) body = sanitizeMessageBody(rawBody);
    } catch (e) {
      throw new BadRequestException(e instanceof Error ? e.message : 'Invalid message');
    }

    // A reply must point at a real message on THIS job — validated so a client can't smuggle in an
    // arbitrary id (and so a deleted/foreign id is dropped rather than stored as a dangling reference).
    let validReplyTo: string | undefined;
    if (typeof replyToId === 'string' && replyToId) {
      const target = await this.repo.find(jobId, replyToId);
      if (target) validReplyTo = replyToId;
    }
    const stored = await this.repo.add({
      jobId, senderId: actorId, body,
      ...(validReplyTo ? { replyToId: validReplyTo } : {}),
      ...(audioKey ? { audioKey } : {}),
      ...(audioDurationMs != null ? { audioDurationMs } : {}),
      ...(imageKey ? { imageKey } : {}),
    });

    // Tell the *other* party a message arrived. Best-effort and fail-closed: a push failure must
    // never fail the send, and the counterparty is derived server-side (the IDOR guard) so we can
    // only ever notify the one other participant. The push carries no message text.
    const counterparty = chatCounterparty(job, actorId);
    if (counterparty) {
      try { await this.notify.record(counterparty, { ...chatNotification(), jobId, kind: 'chat', urgent: true }); }
      catch { /* notifications are best-effort — the message is already stored */ }
    }
    return (await this.withAttachmentUrls([stored]))[0]!;
  }

  /**
   * Replace each attachment's stored key with a short-lived signed URL (keys never leave the server).
   * Handles voice notes (audioKey → audioUrl) and photos (imageKey → imageUrl).
   */
  private async withAttachmentUrls(messages: ChatMessage[]): Promise<ChatMessage[]> {
    return Promise.all(messages.map(async (m) => {
      let out: ChatMessage = m;
      if (out.audioKey) {
        const { audioKey, ...rest } = out;
        try { out = { ...rest, audioUrl: await this.store.signedGetUrl(audioKey, AUDIO_VIEW_TTL) }; }
        catch { out = rest; } // signing failed — drop playback rather than erroring the whole list
      }
      if (out.imageKey) {
        const { imageKey, ...rest } = out;
        try { out = { ...rest, imageUrl: await this.store.signedGetUrl(imageKey, IMAGE_VIEW_TTL) }; }
        catch { out = rest; }
      }
      return out;
    }));
  }

  /**
   * Flag an abusive/objectionable message for platform review (App Store Guideline 1.2). Party-only,
   * and a user can't report their own message. The report is stored for the platform's moderation
   * queue; the reporter gets a simple acknowledgement.
   */
  async report(actorId: string, jobId: string, messageId: string, rawReason?: string): Promise<MessageReport> {
    await this.jobs.getJob(actorId, jobId); // authorises (party-only) or throws
    const msg = await this.repo.find(jobId, messageId);
    if (!msg) throw new NotFoundException('Message not found');
    if (msg.senderId === actorId) throw new BadRequestException('You cannot report your own message');
    const reason = typeof rawReason === 'string' ? rawReason.trim().slice(0, MAX_REASON_LEN) : undefined;
    return this.reports.add({ jobId, messageId, reporterId: actorId, ...(reason ? { reason } : {}) });
  }
}
