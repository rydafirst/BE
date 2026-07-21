import { Injectable, Logger } from '@nestjs/common';
import type { PushDispatcher, PushMessage } from '../ports.js';
import {
  EMPTY_REPORT, isValidExpoToken, pushChannel, pushPriority, pushSound, readExpoTickets,
  type PushDeliveryReport,
} from '../domain/push.js';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const BATCH_SIZE = 100; // Expo accepts up to 100 messages per request

function toExpoMessage(m: PushMessage) {
  return {
    to: m.to,
    title: m.title,
    body: m.body,
    // Urgent events ring like Uber; routine updates arrive as a silent banner.
    sound: pushSound(m.urgent),
    priority: pushPriority(m.urgent),
    channelId: pushChannel(m.urgent),
    ...(m.jobId ? { data: { jobId: m.jobId } } : {}),
  };
}

/** DEV: logs push messages instead of hitting the network. */
@Injectable()
export class DevPushDispatcher implements PushDispatcher {
  private log = new Logger('Push');
  async dispatch(messages: PushMessage[]): Promise<PushDeliveryReport> {
    for (const m of messages) this.log.debug(`push -> ${m.to}: ${m.title} — ${m.body}${m.urgent ? ' [urgent]' : ''}`);
    return { ...EMPTY_REPORT, accepted: messages.length };
  }
}

/** Sends push notifications through the Expo push service. Best-effort: failures are logged, never thrown. */
@Injectable()
export class ExpoPushDispatcher implements PushDispatcher {
  private log = new Logger('ExpoPush');
  async dispatch(messages: PushMessage[]): Promise<PushDeliveryReport> {
    const deliverable = messages.filter((m) => isValidExpoToken(m.to));
    const dropped = messages.length - deliverable.length;
    if (dropped > 0) this.log.warn(`Skipped ${dropped} message(s) with malformed push tokens`);
    if (deliverable.length === 0) return EMPTY_REPORT;

    let accepted = 0;
    const failed: Array<{ token: string; reason: string }> = [];
    const invalidTokens: string[] = [];

    for (let i = 0; i < deliverable.length; i += BATCH_SIZE) {
      const batch = deliverable.slice(i, i + BATCH_SIZE);
      const tokens = batch.map((m) => m.to);
      try {
        const res = await fetch(EXPO_PUSH_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(batch.map(toExpoMessage)),
        });
        if (!res.ok) {
          this.log.warn(`Expo push responded ${res.status} for ${tokens.length} message(s)`);
          continue;
        }
        // A 200 does NOT mean delivered — the per-message verdict is in the body.
        const report = readExpoTickets(tokens, await res.json().catch(() => null));
        accepted += report.accepted;
        failed.push(...report.failed);
        invalidTokens.push(...report.invalidTokens);
        for (const f of report.failed) this.log.warn(`Push rejected for ${f.token}: ${f.reason}`);
      } catch (e) {
        this.log.warn(`Expo push failed: ${(e as Error).message}`);
      }
    }
    return { accepted, failed, invalidTokens };
  }
}
