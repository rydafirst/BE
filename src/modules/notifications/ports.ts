export interface NotificationOutbox {
  seen(key: string): Promise<boolean>;
  mark(key: string): Promise<void>;
}
export const NOTIFICATION_OUTBOX = Symbol('NOTIFICATION_OUTBOX');

export interface PushSender { send(userId: string, message: string): Promise<boolean>; } // returns delivered?
export const PUSH_SENDER = Symbol('PUSH_SENDER');

export interface SmsSender { send(phone: string, message: string): Promise<void>; }
export const SMS_SENDER = Symbol('SMS_SENDER');
