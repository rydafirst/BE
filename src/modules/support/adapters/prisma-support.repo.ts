import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service.js';
import type {
  NewSupportMessage, NewThread, SupportMessage, SupportRepo, SupportThread,
} from '../ports.js';
import type { SupportCategory, SupportStatus } from '../domain/support.js';

interface ThreadRow {
  id: string; userId: string; jobId: string | null; category: string; status: string;
  agentId: string | null; agentJoinDeadline: bigint | null; createdAt: Date; updatedAt: Date;
}
function toThread(r: ThreadRow): SupportThread {
  return {
    id: r.id, userId: r.userId, category: r.category as SupportCategory, status: r.status as SupportStatus,
    createdAt: r.createdAt.getTime(), updatedAt: r.updatedAt.getTime(),
    ...(r.jobId ? { jobId: r.jobId } : {}),
    ...(r.agentId ? { agentId: r.agentId } : {}),
    ...(r.agentJoinDeadline !== null ? { agentJoinDeadline: Number(r.agentJoinDeadline) } : {}),
  };
}

interface MsgRow { id: string; threadId: string; sender: string; senderId: string | null; body: string; createdAt: Date }
function toMessage(r: MsgRow): SupportMessage {
  return {
    id: r.id, threadId: r.threadId, sender: r.sender as SupportMessage['sender'], body: r.body,
    createdAt: r.createdAt.getTime(), ...(r.senderId ? { senderId: r.senderId } : {}),
  };
}

/** Postgres-backed support threads + messages (persistent). Mirrors PrismaMessageRepo. */
@Injectable()
export class PrismaSupportRepo implements SupportRepo {
  constructor(private readonly db: PrismaService) {}

  async createThread(t: NewThread): Promise<SupportThread> {
    const row = await this.db.supportThread.create({
      data: { userId: t.userId, jobId: t.jobId ?? null, category: t.category, status: t.status },
    });
    return toThread(row as ThreadRow);
  }

  async findThread(id: string): Promise<SupportThread | null> {
    const row = await this.db.supportThread.findUnique({ where: { id } });
    return row ? toThread(row as ThreadRow) : null;
  }

  async listByUser(userId: string): Promise<SupportThread[]> {
    const rows = await this.db.supportThread.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });
    return (rows as ThreadRow[]).map(toThread);
  }

  async listOpen(limit: number): Promise<SupportThread[]> {
    const rows = await this.db.supportThread.findMany({
      where: { status: { in: ['AWAITING_AGENT', 'AGENT_JOINED'] } },
      orderBy: { updatedAt: 'asc' }, take: limit,
    });
    return (rows as ThreadRow[]).map(toThread);
  }

  async addMessage(m: NewSupportMessage): Promise<SupportMessage> {
    const row = await this.db.supportMessage.create({
      data: { threadId: m.threadId, sender: m.sender, senderId: m.senderId ?? null, body: m.body },
    });
    return toMessage(row as MsgRow);
  }

  async listMessages(threadId: string, limit: number): Promise<SupportMessage[]> {
    const rows = await this.db.supportMessage.findMany({ where: { threadId }, orderBy: { createdAt: 'asc' }, take: limit });
    return (rows as MsgRow[]).map(toMessage);
  }

  async setStatus(threadId: string, status: SupportStatus, agentJoinDeadline?: number): Promise<SupportThread> {
    try {
      const row = await this.db.supportThread.update({
        where: { id: threadId },
        data: { status, ...(agentJoinDeadline !== undefined ? { agentJoinDeadline: BigInt(agentJoinDeadline) } : {}) },
      });
      return toThread(row as ThreadRow);
    } catch {
      throw new NotFoundException('Support thread not found');
    }
  }

  async assignAgent(threadId: string, agentId: string): Promise<SupportThread> {
    try {
      const row = await this.db.supportThread.update({ where: { id: threadId }, data: { agentId } });
      return toThread(row as ThreadRow);
    } catch {
      throw new NotFoundException('Support thread not found');
    }
  }
}
