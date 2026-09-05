import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitErrand, errandCollectedMinor } from './errand.js';

test('splits: vendor gets goods, rider gets fee minus platform, platform keeps its cut', () => {
  const s = splitErrand({ goodsMinor: 500000, deliveryTotalMinor: 90000, platformFeeMinor: 9000 });
  assert.equal(s.vendorMinor, 500000);
  assert.equal(s.riderMinor, 81000);   // 90000 fee - 9000 platform
  assert.equal(s.platformMinor, 9000);
});

test('MONEY INVARIANT: vendor + rider + platform == collected (goods + delivery fee)', () => {
  const goods = 500000, fee = 90000, plat = 9000;
  const s = splitErrand({ goodsMinor: goods, deliveryTotalMinor: fee, platformFeeMinor: plat });
  assert.equal(errandCollectedMinor(s), goods + fee, 'no money created or lost');
});

test('a top-up raises the goods (vendor) leg only, never the rider/platform', () => {
  const base = splitErrand({ goodsMinor: 500000, deliveryTotalMinor: 90000, platformFeeMinor: 9000 });
  const topped = splitErrand({ goodsMinor: 650000, deliveryTotalMinor: 90000, platformFeeMinor: 9000 }); // +1500 top-up
  assert.equal(topped.vendorMinor - base.vendorMinor, 150000);
  assert.equal(topped.riderMinor, base.riderMinor);
  assert.equal(topped.platformMinor, base.platformMinor);
});

test('the rider is NEVER credited the goods-money', () => {
  const s = splitErrand({ goodsMinor: 999999, deliveryTotalMinor: 90000, platformFeeMinor: 9000 });
  assert.equal(s.riderMinor, 81000, 'rider earns only the delivery fee, regardless of goods value');
});

test('guards: rejects negatives and a platform fee larger than the delivery fee', () => {
  assert.throws(() => splitErrand({ goodsMinor: -1, deliveryTotalMinor: 90000, platformFeeMinor: 9000 }));
  assert.throws(() => splitErrand({ goodsMinor: 500000, deliveryTotalMinor: 9000, platformFeeMinor: 90000 }));
});
