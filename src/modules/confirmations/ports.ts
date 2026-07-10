import type { CodeKind, CodeRecord } from './domain/confirmation-code.js';

export interface ConfirmationCodeRepository {
  save(jobId: string, record: CodeRecord): Promise<void>;
  find(jobId: string, kind: CodeKind): Promise<CodeRecord | null>;
  incrementAttempts(jobId: string, kind: CodeKind): Promise<void>;
  markConsumed(jobId: string, kind: CodeKind): Promise<void>;
}
export const CODE_REPO = Symbol('CODE_REPO');
