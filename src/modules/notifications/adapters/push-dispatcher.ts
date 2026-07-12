import { Injectable, Logger } from '@nestjs/common';
import type { PushDispatcher, PushMessage } from '../ports.js';
import { isValidExpoToken, pushChannel, pushPriority, pushSound } from '../domain/push.js';

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
  async dispatch(messages: PushMessage[]): Promise<void> {
    for (const m of messages) this.log.debug(`push -> ${m.to}: ${m.title} — ${m.body}${m.urgent ? ' [urgent]' : ''}`);
  }
}

/** Sends push notifications through the Expo push service. Best-effort: failures are logged, never thrown. */
@Injectable()
export class ExpoPushDispatcher implements PushDispatcher {
  private log = new Logger('ExpoPush');
  async dispatch(messages: PushMessage[]): Promise<void> {
    const valid = messages.filter((m) => isValidExpoToken(m.to)).map(toExpoMessage);
    if (valid.length === 0) return;
    for (let i = 0; i < valid.length; i += BATCH_SIZE) {
      const batch = valid.slice(i, i + BATCH_SIZE);
      try {
        const res = await fetch(EXPO_PUSH_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(batch),
        });
        if (!res.ok) this.log.warn(`Expo push responded ${res.status}`);
      } catch (e) {
        this.log.warn(`Expo push failed: ${(e as Error).message}`);
      }
    }
  }
}
