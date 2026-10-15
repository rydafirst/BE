import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  documentOnboardingStatus, documentsClearRider, requiredDocuments,
  type DocumentType,
} from './document-catalog.js';

const LAGOS = { city: 'LAGOS' as const, requireGuarantor: false };

test('Lagos car track pulls in LASRRA, LASDRI and hackney permit', () => {
  const req = requiredDocuments('CAR', LAGOS);
  for (const t of ['LICENSE', 'INSURANCE', 'ROADWORTHINESS', 'LASRRA', 'LASDRI', 'HACKNEY_PERMIT'] as DocumentType[]) {
    assert.ok(req.includes(t), `expected ${t}`);
  }
  assert.ok(!req.includes('KEKE_PERMIT'));
});

test('Lagos bike track needs LASRRA but not car-only permits', () => {
  const req = requiredDocuments('BIKE', LAGOS);
  assert.ok(req.includes('LASRRA'));
  assert.ok(!req.includes('HACKNEY_PERMIT'));
  assert.ok(!req.includes('LASDRI'));
  assert.ok(!req.includes('KEKE_PERMIT'));
});

test('keke track pulls in the tricycle permit', () => {
  assert.ok(requiredDocuments('KEKE', LAGOS).includes('KEKE_PERMIT'));
});

test('admin-disabled document types are dropped from the required set', () => {
  const base = requiredDocuments('CAR', LAGOS);
  assert.ok(base.includes('PROOF_OF_OWNERSHIP'));
  const req = requiredDocuments('CAR', { ...LAGOS, disabledTypes: ['PROOF_OF_OWNERSHIP', 'INSURANCE'] });
  assert.ok(!req.includes('PROOF_OF_OWNERSHIP'), 'proof of ownership hidden');
  assert.ok(!req.includes('INSURANCE'), 'insurance hidden');
  assert.ok(req.includes('LICENSE'), 'other docs untouched');
});

test('identity documents can never be disabled (locked on)', () => {
  const req = requiredDocuments('BIKE', { ...LAGOS, disabledTypes: ['PROFILE_PHOTO', 'GOV_ID'] });
  assert.ok(req.includes('PROFILE_PHOTO'), 'profile photo stays required');
  assert.ok(req.includes('GOV_ID'), 'government ID stays required');
});

test('bicycle track asks for identity docs only — no licence, vehicle or permit documents', () => {
  const req = requiredDocuments('BICYCLE', LAGOS);
  // Only the identity/onboarding basics a non-registered pedal-bike rider can actually provide.
  assert.deepEqual([...req].sort(), ['ADDRESS_PROOF', 'GOV_ID', 'PROFILE_PHOTO'].sort());
  for (const t of ['LICENSE', 'VEHICLE_REG', 'PROOF_OF_OWNERSHIP', 'ROADWORTHINESS', 'INSURANCE', 'VEHICLE_PHOTO', 'LASRRA', 'LASDRI', 'HACKNEY_PERMIT', 'KEKE_PERMIT'] as DocumentType[]) {
    assert.ok(!req.includes(t), `bicycle should NOT require ${t}`);
  }
});

test('bicycle still picks up the guarantor when the flag is on', () => {
  assert.ok(!requiredDocuments('BICYCLE', LAGOS).includes('GUARANTOR'));
  assert.ok(requiredDocuments('BICYCLE', { city: 'LAGOS', requireGuarantor: true }).includes('GUARANTOR'));
});

test('non-Lagos city drops the Lagos-only permits', () => {
  const req = requiredDocuments('CAR', { city: 'ABUJA', requireGuarantor: false });
  assert.ok(!req.includes('LASRRA'));
  assert.ok(!req.includes('HACKNEY_PERMIT'));
  assert.ok(req.includes('LICENSE'));
});

test('guarantor is required only when the flag is on', () => {
  assert.ok(!requiredDocuments('BIKE', { city: 'LAGOS', requireGuarantor: false }).includes('GUARANTOR'));
  assert.ok(requiredDocuments('BIKE', { city: 'LAGOS', requireGuarantor: true }).includes('GUARANTOR'));
});

test('onboarding status is fail-closed by precedence', () => {
  const req: DocumentType[] = ['LICENSE', 'INSURANCE'];
  assert.equal(documentOnboardingStatus(req, {}), 'INCOMPLETE');               // nothing uploaded
  assert.equal(documentOnboardingStatus(req, { LICENSE: 'SUBMITTED' }), 'INCOMPLETE'); // one still missing
  assert.equal(documentOnboardingStatus(req, { LICENSE: 'SUBMITTED', INSURANCE: 'UNDER_REVIEW' }), 'UNDER_REVIEW');
  assert.equal(documentOnboardingStatus(req, { LICENSE: 'APPROVED', INSURANCE: 'REJECTED' }), 'ACTION_REQUIRED');
  assert.equal(documentOnboardingStatus(req, { LICENSE: 'APPROVED', INSURANCE: 'EXPIRED' }), 'EXPIRED');
  assert.equal(documentOnboardingStatus(req, { LICENSE: 'APPROVED', INSURANCE: 'APPROVED' }), 'APPROVED');
});

test('only a fully-approved set clears the rider', () => {
  assert.equal(documentsClearRider('APPROVED'), true);
  for (const s of ['INCOMPLETE', 'UNDER_REVIEW', 'ACTION_REQUIRED', 'EXPIRED'] as const) {
    assert.equal(documentsClearRider(s), false);
  }
});

test('expired outranks rejected outranks missing', () => {
  const req: DocumentType[] = ['LICENSE', 'INSURANCE', 'ROADWORTHINESS'];
  assert.equal(
    documentOnboardingStatus(req, { LICENSE: 'EXPIRED', INSURANCE: 'REJECTED' }),
    'EXPIRED',
  );
  assert.equal(
    documentOnboardingStatus(req, { LICENSE: 'REJECTED', INSURANCE: 'MISSING' }),
    'ACTION_REQUIRED',
  );
});
