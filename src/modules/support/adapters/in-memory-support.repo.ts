import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type {
  NewSupportMessage, NewThread, SupportMessage, SupportRepo, SupportThread,
} from '../ports.js';
import type { SupportStatus } from '../domain/support.js';

// DEV + test default. Swapped for the Postgres-backed repo when DB_DRIVER=postgres.
@Injectable()
export class InMemorySupportRepo implements SupportRepo {
  private threads: SupportThread[] = [];
  private messages: SupportMessage[] = [];

  async createThread(t: NewThread): Promise<SupportThread> {
    const now = Date.now();
    const thread: SupportThread = {
      id: randomUUID(), userId: t.userId, category: t.category, status: t.status,
      createdAt: now, updatedAt: now, ...(t.jobId ? { jobId: t.jobId } : {}),
    };
    this.threads.push(thread);
    return { ...thread };
  }

  async findThread(id: string): Promise<SupportThread | null> {
    const t = this.threads.find((x) => x.id === id);
    return t ? { ...t } : null;
  }

  async listByUser(userId: string): Promise<SupportThread[]> {
    return this.threads
      .filter((t) => t.userId === userId)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((t) => ({ ...t }));
  }

  async listOpen(limit: number): Promise<SupportThread[]> {
    return this.threads
      .filter((t) => t.status === 'AWAITING_AGENT' || t.status === 'AGENT_JOINED')
      .sort((a, b) => a.updatedAt - b.updatedAt) // longest-waiting first
      .slice(0, limit)
      .map((t) => ({ ...t }));
  }

  async addMessage(m: NewSupportMessage): Promise<SupportMessage> {
    const msg: SupportMessage = {
      id: randomUUID(), threadId: m.threadId, sender: m.sender, body: m.body, createdAt: Date.now(),
      ...(m.senderId ? { senderId: m.senderId } : {}),
    };
    this.messages.push(msg);
    return { ...msg };
  }

  async listMessages(threadId: string, limit: number): Promise<SupportMessage[]> {
    return this.messages.filter((m) => m.threadId === threadId).slice(-limit).map((m) => ({ ...m }));
  }

  async setStatus(threadId: string, status: SupportStatus, agentJoinDeadline?: number): Promise<SupportThread> {
    const t = this.threads.find((x) => x.id === threadId);
    if (!t) throw new NotFoundException('Support thread not found');
    t.status = status;
    if (agentJoinDeadline !== undefined) t.agentJoinDeadline = agentJoinDeadline;
    t.updatedAt = Date.now();
    return { ...t };
  }

  async assignAgent(threadId: string, agentId: string): Promise<SupportThread> {
    const t = this.threads.find((x) => x.id === threadId);
    if (!t) throw new NotFoundException('Support thread not found');
    t.agentId = agentId;
    t.updatedAt = Date.now();
    return { ...t };
  }
}
