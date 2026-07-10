/**
 * Exactly-once webhook processing. Provider events are deduped by their id; a re-delivery
 * is recognised and skipped (07-engineering-standards §2.4). Signature verification happens
 * in the provider adapter BEFORE this decision is reached.
 */
export type WebhookDecision = 'process' | 'duplicate';

export function decideWebhook(alreadySeen: boolean): WebhookDecision {
  return alreadySeen ? 'duplicate' : 'process';
}
