import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideRefresh, type RefreshTokenState } from './refresh-rotation.js';

const st = (over: Partial<RefreshTokenState> = {}): RefreshTokenState => ({
  familyId: 'fam1', tokenHash: 'h', rotated: false, revoked: false, ...over,
});

test('valid current token rotates', () => {
  assert.deepEqual(decideRefresh(st()), { action: 'rotate', familyId: 'fam1' });
});

test('replayed (already-rotated) token triggers reuse detection', () => {
  assert.deepEqual(decideRefresh(st({ rotated: true })), { action: 'reuse_detected', familyId: 'fam1' });
});

test('revoked or unknown token is rejected generically', () => {
  assert.deepEqual(decideRefresh(st({ revoked: true })), { action: 'reject' });
  assert.deepEqual(decideRefresh(null), { action: 'reject' });
});
