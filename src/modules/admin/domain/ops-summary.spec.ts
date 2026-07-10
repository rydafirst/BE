import { test } from 'node:test';
import assert from 'node:assert/strict';
import { opsSummary } from './ops-summary.js';

test('counts only non-terminal jobs, grouped by status', () => {
  const s = opsSummary([
    { id: '1', status: 'SEARCHING' },
    { id: '2', status: 'SEARCHING' },
    { id: '3', status: 'EN_ROUTE_DROP' },
    { id: '4', status: 'RELEASED' },   // terminal -> excluded
    { id: '5', status: 'CANCELLED' },  // terminal -> excluded
  ]);
  assert.equal(s.activeTotal, 3);
  assert.equal(s.byStatus.SEARCHING, 2);
  assert.equal(s.byStatus.EN_ROUTE_DROP, 1);
  assert.equal(s.byStatus.RELEASED, undefined);
});
