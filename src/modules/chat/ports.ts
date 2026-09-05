export interface ChatMessage {
  id: string;
  jobId: string;
  senderId: string;
  body: string;
  replyToId?: string; // the message this one replies to (in-thread quote), if any
  audioKey?: string;  // stored object key for a voice note (internal — never sent to a client)
  audioUrl?: string;  // short-lived signed playback URL, resolved at read time from audioKey
  audioDurationMs?: number; // voice-note length for the player UI
  imageKey?: string;  // stored object key for a photo attachment (internal — never sent to a client)
  imageUrl?: string;  // short-lived signed view URL, resolved at read time from imageKey
  createdAt: number;
}
export interface NewMessage {
  jobId: string;
  senderId: string;
  body: string;
  replyToId?: string;
  audioKey?: string;
  audioDurationMs?: number;
  imageKey?: string;
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
