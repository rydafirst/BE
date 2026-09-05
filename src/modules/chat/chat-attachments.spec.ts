/**
 * Chat attachments (voice notes + photos) through the REAL ChatService.
 *
 * Proves:
 *   - a photo upload mints a key scoped to THIS job (chat-image/<jobId>/…);
 *   - posting a message with that key stores it and the read path returns a signed imageUrl (never the key);
 *   - a client cannot attach an arbitrary/foreign object key (it is silently dropped);
 *   - unsupported content types are rejected.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ChatService } from './chat.service.js';
import { InMemoryMessageRepo, InMemoryReportRepo } from './adapters/in-memory-message.repo.js';

const JOB = { id: 'job-1', customerId: 'cust-1', riderId: 'rider-1', status: 'ACCEPTED' };

function build() {
  const store = {
    async presignPut(key: string) { return { uploadUrl: `https://up/${key}` }; },
    async signedGetUrl(key: string) { return `https://get/${key}?sig=abc`; },
  };
  const jobs = { async getJob(_actorId: string, _jobId: string) { return JOB; } };
  const notify = { async record() { /* noop */ } };
  const svc = new ChatService(
    new InMemoryMessageRepo(), new InMemoryReportRepo(),
    store as unknown as never, jobs as unknown as never, notify as unknown as never,
  );
  return { svc };
}

test('PHOTO: upload mints a job-scoped key; posting it returns a signed imageUrl (not the key)', async () => {
  const { svc } = build();
  const { uploadUrl, key } = await svc.requestImageUpload('cust-1', JOB.id, 'image/jpeg', 2048);
  assert.ok(key.startsWith(`chat-image/${JOB.id}/`), 'key is scoped to this job');
  assert.ok(uploadUrl.includes(key));

  const msg = await svc.post('cust-1', JOB.id, 'what to buy', undefined, undefined, key);
  assert.ok(msg.imageUrl && msg.imageUrl.startsWith('https://get/'), 'read path returns a signed URL');
  assert.equal((msg as { imageKey?: string }).imageKey, undefined, 'the raw storage key never leaves the server');
  assert.equal(msg.body, 'what to buy', 'a photo can carry a caption');

  const list = await svc.list('rider-1', JOB.id);
  assert.equal(list.length, 1);
  assert.ok(list[0]!.imageUrl?.startsWith('https://get/'));
});

test('PHOTO: a foreign/arbitrary object key is dropped (cannot attach someone else’s object)', async () => {
  const { svc } = build();
  const msg = await svc.post('cust-1', JOB.id, 'hi', undefined, undefined, 'chat-image/other-job/evil.jpg');
  assert.equal(msg.imageUrl, undefined, 'a key not scoped to this job is ignored');
  assert.equal(msg.body, 'hi');
});

test('PHOTO: unsupported content types are rejected', async () => {
  const { svc } = build();
  await assert.rejects(svc.requestImageUpload('cust-1', JOB.id, 'application/pdf', 2048));
});
