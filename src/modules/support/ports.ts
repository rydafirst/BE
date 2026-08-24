import type { SupportCategory, SupportStatus } from './domain/support.js';

/**
 * A support conversation. Not tied to a job by default; when `jobId` is set the thread is scoped to a
 * specific trip (launch item #6 — per-trip support, resumable from the trip's details).
 */
export interface SupportThread {
  id: string;
  userId: string;
  jobId?: string;
  category: SupportCategory;
  status: SupportStatus;
  agentId?: string;
  /** Epoch ms by which a human agent should have joined (set on escalation). */
  agentJoinDeadline?: number;
  createdAt: number;
  updatedAt: number;
}

export interface NewThread {
  userId: string;
  jobId?: string;
  category: SupportCategory;
  status: SupportStatus;
}

/** One line in a support thread. `sender` says who spoke; `senderId` is the user/agent id (absent for the bot). */
export interface SupportMessage {
  id: string;
  threadId: string;
  sender: 'USER' | 'BOT' | 'AGENT';
  senderId?: string;
  body: string;
  createdAt: number;
}

export interface NewSupportMessage {
  threadId: string;
  sender: 'USER' | 'BOT' | 'AGENT';
  senderId?: string;
  body: string;
}

export interface ThreadPatch {
  status?: SupportStatus;
  agentId?: string;
  agentJoinDeadline?: number;
}

export interface SupportRepo {
  createThread(t: NewThread): Promise<SupportThread>;
  findThread(id: string): Promise<SupportThread | null>;
  /** Every thread owned by a user, newest first (their support inbox). */
  listByUser(userId: string): Promise<SupportThread[]>;
  /** Open threads for agents to pick up: AWAITING_AGENT or AGENT_JOINED, oldest-waiting first. */
  listOpen(limit: number): Promise<SupportThread[]>;
  addMessage(m: NewSupportMessage): Promise<SupportMessage>;
  /** Messages for a thread, oldest first, capped. */
  listMessages(threadId: string, limit: number): Promise<SupportMessage[]>;
  setStatus(threadId: string, status: SupportStatus, agentJoinDeadline?: number): Promise<SupportThread>;
  assignAgent(threadId: string, agentId: string): Promise<SupportThread>;
}

export const SUPPORT_REPO = Symbol('SUPPORT_REPO');
