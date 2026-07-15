export interface ChatMessage {
  id: string;
  jobId: string;
  senderId: string;
  body: string;
  createdAt: number;
}
export interface NewMessage {
  jobId: string;
  senderId: string;
  body: string;
}

export interface MessageRepo {
  add(msg: NewMessage): Promise<ChatMessage>;
  /** Messages for a job, oldest first, capped. */
  listForJob(jobId: string, limit: number): Promise<ChatMessage[]>;
  /** A single message (to verify it exists + belongs to the job before reporting it). */
  find(jobId: string, messageId: string): Promise<ChatMessage | null>;
}
export const MESSAGE_REPO = Symbol('MESSAGE_REPO');

/** A user-submitted report of an abusive/objectionable message (Guideline 1.2 moderation). */
export interface MessageReport {
  id: string;
  jobId: string;
  messageId: string;
  reporterId: string;
  reason?: string;
  createdAt: number;
}
export interface NewReport {
  jobId: string;
  messageId: string;
  reporterId: string;
  reason?: string;
}
export interface ReportRepo {
  add(report: NewReport): Promise<MessageReport>;
  /** Open reports for the platform to review (newest first). */
  listRecent(limit: number): Promise<MessageReport[]>;
}
export const REPORT_REPO = Symbol('REPORT_REPO');
