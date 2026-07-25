/**
 * The pool-tuning URL builder decides how a busy or degraded database behaves for a real user: too
 * many connections and the DB refuses them; no timeout and a request hangs forever. These tests pin
 * the two properties that matter — the defaults get applied, and an explicit operator override is
 * never clobbered.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDatasourceUrl } from './datasource-url.js';

const tuning = { connectionLimit: 10, poolTimeoutSeconds: 20 };

test('appends connection_limit and pool_timeout when absent', () => {
  const out = new URL(buildDatasourceUrl('postgresql://u:p@host:5432/db', tuning));
  assert.equal(out.searchParams.get('connection_limit'), '10');
  assert.equal(out.searchParams.get('pool_timeout'), '20');
});

test('respects an explicit connection_limit already in the URL', () => {
  const out = new URL(buildDatasourceUrl('postgresql://u:p@host:5432/db?connection_limit=5', tuning));
  assert.equal(out.searchParams.get('connection_limit'), '5'); // operator override wins
  assert.equal(out.searchParams.get('pool_timeout'), '20'); // the omitted one still gets a default
});

test('respects an explicit pool_timeout already in the URL', () => {
  const out = new URL(buildDatasourceUrl('postgresql://u:p@host:5432/db?pool_timeout=45', tuning));
  assert.equal(out.searchParams.get('pool_timeout'), '45');
  assert.equal(out.searchParams.get('connection_limit'), '10');
});

test('preserves unrelated query params (e.g. schema, sslmode)', () => {
  const out = new URL(buildDatasourceUrl('postgresql://u:p@host:5432/db?schema=public&sslmode=require', tuning));
  assert.equal(out.searchParams.get('schema'), 'public');
  assert.equal(out.searchParams.get('sslmode'), 'require');
  assert.equal(out.searchParams.get('connection_limit'), '10');
});

test('is idempotent — re-running over its own output changes nothing', () => {
  const once = buildDatasourceUrl('postgresql://u:p@host:5432/db', tuning);
  const twice = buildDatasourceUrl(once, tuning);
  assert.equal(twice, once);
});

test('keeps credentials and host intact', () => {
  const out = new URL(buildDatasourceUrl('postgresql://user:s3cret@db.internal:5432/rydafirst', tuning));
  assert.equal(out.username, 'user');
  assert.equal(out.password, 's3cret');
  assert.equal(out.host, 'db.internal:5432');
  assert.equal(out.pathname, '/rydafirst');
});
