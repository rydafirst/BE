import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service.js';
import type { ChatMessage, MessageRepo, NewMessage, MessageReport, NewReport, ReportRepo } from '../ports.js';

// The generated Prisma client can lag the schema in environments where `prisma generate` hasn't run
// against the newest column (e.g. offline CI). `never` lets the write type-check both there and in prod,
// exactly as the job repo does; at build time the real generated types are used.
type PrismaWrite = never;

interface Row { id: string; jobId: string; senderId: string; body: string; replyToId: string | null; audioKey: string | null; audioDurationMs: number | null; imageKey: string | null; createdAt: Date }
function toMessage(r: Row): ChatMessage {
  return {
    id: r.id, jobId: r.jobId, senderId: r.senderId, body: r.body,
    ...(r.replyToId ? { replyToId: r.replyToId } : {}),
    ...(r.audioKey ? { audioKey: r.audioKey } : {}),
    ...(r.audioDurationMs != null ? { audioDurationMs: r.audioDurationMs } : {}),
    ...(r.imageKey ? { imageKey: r.imageKey } : {}),
    createdAt: r.createdAt.getTime(),
  };
}

/** Postgres-backed chat messages (persistent, one row per message). */
@Injectable()
export class PrismaMessageRepo implements MessageRepo {
  constructor(private readonly db: PrismaService) {}

  async add(n: NewMessage): Promise<ChatMessage> {
    const row = await this.db.chatMessage.create({
      data: { jobId: n.jobId, senderId: n.senderId, body: n.body, replyToId: n.replyToId ?? null, audioKey: n.audioKey ?? null, audioDurationMs: n.audioDurationMs ?? null, imageKey: n.imageKey ?? null } as PrismaWrite,
    });
    return toMessage(row as unknown as Row);
  }
  async listForJob(jobId: string, limit: number): Promise<ChatMessage[]> {
    const rows = await this.db.chatMessage.findMany({ where: { jobId }, orderBy: { createdAt: 'asc' }, take: limit });
    return (rows as unknown as Row[]).map(toMessage);
  }
  async find(jobId: string, messageId: string): Promise<ChatMessage | null> {
    const row = await this.db.chatMessage.findFirst({ where: { id: messageId, jobId } });
    return row ? toMessage(row as unknown as Row) : null;
  }
}

interface ReportRow { id: string; jobId: string; messageId: string; reporterId: string; reason: string | null; createdAt: Date }
function toReport(r: ReportRow): MessageReport {
  return { id: r.id, jobId: r.jobId, messageId: r.messageId, reporterId: r.reporterId, createdAt: r.createdAt.getTime(), ...(r.reason ? { reason: r.reason } : {}) };
}

/** Postgres-backed message reports (moderation queue for the platform). */
@Injectable()
export class PrismaReportRepo implements ReportRepo {
  constructor(private readonly db: PrismaService) {}
  async add(n: NewReport): Promise<MessageReport> {
    const row = await this.db.messageReport.create({
      data: { jobId: n.jobId, messageId: n.messageId, reporterId: n.reporterId, reason: n.reason ?? null },
    });
    return toReport(row as ReportRow);
  }
  async listRecent(limit: number): Promise<MessageReport[]> {
    const rows = await this.db.messageReport.findMany({ orderBy: { createdAt: 'desc' }, take: limit });
    return (rows as ReportRow[]).map(toReport);
  }
}
