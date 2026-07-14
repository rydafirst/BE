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
}
export const MESSAGE_REPO = Symbol('MESSAGE_REPO');
