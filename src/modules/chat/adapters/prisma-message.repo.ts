import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service.js';
import type { ChatMessage, MessageRepo, NewMessage } from '../ports.js';

interface Row { id: string; jobId: string; senderId: string; body: string; createdAt: Date }
function toMessage(r: Row): ChatMessage {
  return { id: r.id, jobId: r.jobId, senderId: r.senderId, body: r.body, createdAt: r.createdAt.getTime() };
}

/** Postgres-backed chat messages (persistent, one row per message). */
@Injectable()
export class PrismaMessageRepo implements MessageRepo {
  constructor(private readonly db: PrismaService) {}

  async add(n: NewMessage): Promise<ChatMessage> {
    const row = await this.db.chatMessage.create({
      data: { jobId: n.jobId, senderId: n.senderId, body: n.body },
    });
    return toMessage(row as Row);
  }
  async listForJob(jobId: string, limit: number): Promise<ChatMessage[]> {
    const rows = await this.db.chatMessage.findMany({ where: { jobId }, orderBy: { createdAt: 'asc' }, take: limit });
    return (rows as Row[]).map(toMessage);
  }
}
