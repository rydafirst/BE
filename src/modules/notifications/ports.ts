import type { PushDeliveryReport } from './domain/push.js';

export interface NotificationOutbox {
  seen(key: string): Promise<boolean>;
  mark(key: string): Promise<void>;
}
export const NOTIFICATION_OUTBOX = Symbol('NOTIFICATION_OUTBOX');

export interface PushSender { send(userId: string, message: string): Promise<boolean>; } // returns delivered?
export const PUSH_SENDER = Symbol('PUSH_SENDER');

export interface SmsSender { send(phone: string, message: string): Promise<void>; }
export const SMS_SENDER = Symbol('SMS_SENDER');

/** A persisted per-user in-app notification (the bell/list feed). */
export interface NotificationItem {
  id: string;
  jobId?: string;
  title: string;
  body: string;
  createdAt: number; // epoch ms
  read: boolean;
}
export interface NotificationFeed {
  append(userId: string, item: NotificationItem): Promise<void>;
  list(userId: string, limit: number): Promise<NotificationItem[]>;
  markAllRead(userId: string): Promise<void>;
  unreadCount(userId: string): Promise<number>;
}
export const NOTIFICATION_FEED = Symbol('NOTIFICATION_FEED');

/** A registered device that can receive push notifications for a user. */
export interface PushToken { token: string; platform: 'ios' | 'android'; }
export interface PushTokenStore {
  save(userId: string, token: PushToken): Promise<void>;
  remove(userId: string, token: string): Promise<void>;
  listForUser(userId: string): Promise<PushToken[]>;
}
export const PUSH_TOKEN_STORE = Symbol('PUSH_TOKEN_STORE');

/** A single push message to deliver to one device token. */
export interface PushMessage {
  to: string;        // device push token
  title: string;
  body: string;
  urgent: boolean;   // urgent → play a sound (like Uber); otherwise silent banner
  jobId?: string;
}
/**
 * Delivers push messages to devices (Expo push service in prod; a dev logger otherwise).
 * Returns what actually happened so the caller can retire tokens the provider rejected — without
 * this, dead devices accumulate forever and quietly degrade every send.
 */
export interface PushDispatcher {
  dispatch(messages: PushMessage[]): Promise<PushDeliveryReport>;
}
export const PUSH_DISPATCHER = Symbol('PUSH_DISPATCHER');
