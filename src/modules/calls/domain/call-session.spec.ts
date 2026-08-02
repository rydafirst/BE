import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  buildDialXml,
  buildEmptyXml,
  buildRejectXml,
  isBridgeable,
  xmlEscape,
} from './call-session.js';

test('isBridgeable: only a fresh RINGING session that has not expired can bridge', () => {
  const now = 1_000_000;
  assert.equal(isBridgeable({ status: 'RINGING', expiresAt: now + 1000 }, now), true);
  assert.equal(isBridgeable({ status: 'RINGING', expiresAt: now - 1 }, now), false, 'expired');
  assert.equal(isBridgeable({ status: 'PENDING', expiresAt: now + 1000 }, now), false, 'not yet placed');
  assert.equal(isBridgeable({ status: 'CONNECTED', expiresAt: now + 1000 }, now), false, 'already bridged');
  assert.equal(isBridgeable({ status: 'COMPLETED', expiresAt: now + 1000 }, now), false);
});

test('xmlEscape: neutralises the characters that could break out of an attribute', () => {
  assert.equal(xmlEscape(`a&b<c>d"e'f`), 'a&amp;b&lt;c&gt;d&quot;e&apos;f');
});

test('buildDialXml: bridges to the number behind our caller id, with a capped duration', () => {
  const xml = buildDialXml('+2348030000000', '+2348111111111', 600);
  assert.match(xml, /^<\?xml version="1.0" encoding="UTF-8"\?>/);
  assert.match(xml, /phoneNumbers="\+2348030000000"/);
  assert.match(xml, /callerId="\+2348111111111"/);
  assert.match(xml, /maxDuration="600"/);
  assert.match(xml, /record="false"/);
});

test('buildDialXml: floors and floors-to-minimum the max duration', () => {
  assert.match(buildDialXml('+234', '+234', 12.9), /maxDuration="12"/);
  assert.match(buildDialXml('+234', '+234', 0), /maxDuration="1"/);
});

test('buildRejectXml: says the message then rejects', () => {
  const xml = buildRejectXml('This delivery has ended.');
  assert.match(xml, /<Say>This delivery has ended.<\/Say>/);
  assert.match(xml, /<Reject\/>/);
});

test('buildEmptyXml: a bare acknowledgement response', () => {
  assert.equal(buildEmptyXml(), '<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
});
