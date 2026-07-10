import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideWebhook } from './webhook-inbox.js';

test('processes a new event', () => assert.equal(decideWebhook(false), 'process'));
test('skips a re-delivered event (exactly-once)', () => assert.equal(decideWebhook(true), 'duplicate'));
