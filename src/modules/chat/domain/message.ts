/** Chat message validation. Pure + testable — no framework or I/O. */
export const MAX_MESSAGE_LEN = 1000;

/**
 * Normalize and validate a message body. Trims surrounding whitespace, rejects empty messages and
 * anything over the length cap. Throws a plain Error the service maps to a 400.
 */
export function sanitizeMessageBody(raw: unknown): string {
  if (typeof raw !== 'string') throw new Error('Message body must be text');
  const body = raw.trim();
  if (body.length === 0) throw new Error('Message cannot be empty');
  if (body.length > MAX_MESSAGE_LEN) throw new Error('Message is too long');
  return body;
}
