import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryDocumentRepo } from './in-memory-document.repo.js';

test('rider profile round-trips the guarantor details', async () => {
  const repo = new InMemoryDocumentRepo();
  await repo.setTrack('rider-1', 'BICYCLE');
  await repo.setProfile('rider-1', {
    guarantorName: 'Musa Ibrahim',
    guarantorPhone: '08030000000',
    guarantorAddress: '12 Allen Ave, Ikeja',
    guarantorRelationship: 'Uncle',
  });
  const p = await repo.getProfile('rider-1');
  assert.equal(p.track, 'BICYCLE');
  assert.equal(p.guarantorName, 'Musa Ibrahim');
  assert.equal(p.guarantorPhone, '08030000000');
  assert.equal(p.guarantorAddress, '12 Allen Ave, Ikeja');
  assert.equal(p.guarantorRelationship, 'Uncle');
});

test('guarantor fields update independently of the legal name / verification', async () => {
  const repo = new InMemoryDocumentRepo();
  await repo.setProfile('rider-2', { legalName: 'Tolu O' });
  await repo.setNameVerified('rider-2', true);
  await repo.setProfile('rider-2', { guarantorName: 'Amaka' }); // must NOT reset name verification
  const p = await repo.getProfile('rider-2');
  assert.equal(p.nameVerified, true);
  assert.equal(p.guarantorName, 'Amaka');
});
