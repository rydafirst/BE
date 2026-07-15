import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { ChatMessage, MessageRepo, NewMessage, NewReport, MessageReport, ReportRepo } from '../ports.js';

// DEV ONLY. Swapped for the Postgres-backed repo when DB_DRIVER=postgres.
@Injectable()
export class InMemoryMessageRepo implements MessageRepo {
  private messages: ChatMessage[] = [];
  async add(n: NewMessage): Promise<ChatMessage> {
    const msg: ChatMessage = { id: randomUUID(), jobId: n.jobId, senderId: n.senderId, body: n.body, createdAt: Date.now() };
    this.messages.push(msg);
    return msg;
  }
  async listForJob(jobId: string, limit: number): Promise<ChatMessage[]> {
    return this.messages.filter((m) => m.jobId === jobId).slice(-limit);
  }
  async find(jobId: string, messageId: string): Promise<ChatMessage | null> {
    return this.messages.find((m) => m.id === messageId && m.jobId === jobId) ?? null;
  }
}

@Injectable()
export class InMemoryReportRepo implements ReportRepo {
  private reports: MessageReport[] = [];
  async add(n: NewReport): Promise<MessageReport> {
    const r: MessageReport = { id: randomUUID(), jobId: n.jobId, messageId: n.messageId, reporterId: n.reporterId, ...(n.reason ? { reason: n.reason } : {}), createdAt: Date.now() };
    this.reports.push(r);
    return r;
  }
  async listRecent(limit: number): Promise<MessageReport[]> {
    return [...this.reports].sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
  }
}
