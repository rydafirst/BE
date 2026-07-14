import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { ChatMessage, MessageRepo, NewMessage } from '../ports.js';

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
}
