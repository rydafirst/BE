import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseChannel, decideNotification, notificationKey, stageMessage } from './notifications.js';

test('arrival message carries the anti-scam guidance', () => {
  assert.match(stageMessage('ARRIVED'), /only when you have the item/i);
});

test('notification key is unique per job + stage', () => {
  assert.equal(notificationKey('j1', 'COMPLETED'), 'notify:j1:COMPLETED');
  assert.notEqual(notificationKey('j1', 'ARRIVED'), notificationKey('j1', 'COMPLETED'));
});

test('sends once, skips on repeat (exactly-once)', () => {
  assert.equal(decideNotification(false), 'send');
  assert.equal(decideNotification(true), 'skip');
});

test('prefers push, falls back to SMS', () => {
  assert.equal(chooseChannel(true), 'push');
  assert.equal(chooseChannel(false), 'sms');
});
