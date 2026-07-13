import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidLegalName, isValidPlate, isValidVehicleColor, normalizePlate } from './rider-profile.js';

test('vehicle colour must be in the palette', () => {
  assert.equal(isValidVehicleColor('BLACK'), true);
  assert.equal(isValidVehicleColor('WHITE'), true);
  assert.equal(isValidVehicleColor('PURPLE'), false);
  assert.equal(isValidVehicleColor('black'), false); // case-sensitive, normalise before check
});

test('legal name accepts real names, rejects junk', () => {
  assert.equal(isValidLegalName('Tolu Olonibua'), true);
  assert.equal(isValidLegalName("O'Brien-Smith"), true);
  assert.equal(isValidLegalName('A'), false);
  assert.equal(isValidLegalName('  '), false);
  assert.equal(isValidLegalName('123 456'), false);
  assert.equal(isValidLegalName('<script>'), false);
});

test('plate normalises and validates', () => {
  assert.equal(normalizePlate(' abc-123-de '), 'ABC 123 DE');
  assert.equal(normalizePlate('lag@#456xy'), 'LAG 456XY');
  assert.equal(isValidPlate('ABC123DE'), true);
  assert.equal(isValidPlate('AB1'), false); // too short
});
