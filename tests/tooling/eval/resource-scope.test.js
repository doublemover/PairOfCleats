import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runEvaluationResourceScope } from '../../../tools/eval/resource-scope.js';
import { createSqliteDbCache } from '../../../src/retrieval/sqlite-cache.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';

// Authored actual scope/cache/lease controls; database close is inert.
const events = [], cache = { retainFailure(error) { events.push(['retained', error]); }, pendingOwners() { return []; },
  dispose() { assert.equal(this, cache); events.push('cache-close'); } };
const display = { close() { assert.equal(this, display); events.push('display-close'); } };
assert.equal(await runEvaluationResourceScope({ sqliteCache: cache, display }, async () => {
  events.push('work'); cache.dispose = () => assert.fail('replacement disposer cannot be adopted'); return 17;
}), 17);
assert.deepEqual(events, ['work', 'cache-close', 'display-close']);
for (const primary of [undefined, null, false, 0, '', Object.freeze(new Error('original operation'))]) {
  const cleanup = Object.freeze(new Error('independent cleanup'));
  let calls = 0, displays = 0, retained;
  const actual = { retainFailure(error) { retained = error; }, pendingOwners() { return []; }, dispose() { calls++; throw cleanup; } };
  await assert.rejects(runEvaluationResourceScope({ sqliteCache: actual, display: { close() { displays++; } } }, async () => { throw primary; }),
    error => error instanceof AggregateError && error.cause === primary && error.errors[0] === primary && error.errors[1] === cleanup);
  assert.equal(retained, primary); assert.equal(calls, 1); assert.equal(displays, 1);
}
const root = await makeTempDir('eval-resource-scope-');
let lease, owner, settled = false, closes = 0, displays = 0;
try {
  const file = path.join(root, 'ordinary.db'); await fs.writeFile(file, 'identity only');
  const actual = createSqliteDbCache(), db = { close() { assert.equal(this, db); closes++; } };
  const primary = Object.assign(new Error('original search still owns native work'), {
    cacheOwnershipPending: false, cacheOwnershipReleased() { assert.equal(this, primary); return settled; }
  });
  actual.set(file, db);
  const failure = await runEvaluationResourceScope({ sqliteCache: actual, display: { close() { displays++; } } },
    async () => { throw primary; }).then(() => assert.fail('pending work must reject'), error => error);
  assert.equal(failure.cause, primary); assert.equal(failure.cacheOwnershipReleased(), false); assert.equal(closes, 0);
  owner = actual.pendingOwners()[0]; primary.cacheOwnershipReleased = () => true;
  assert.throws(() => owner.release()); assert.equal(closes, 0);
  settled = true; owner.release(); assert.equal(closes, 1); assert.equal(failure.cacheOwnershipReleased(), true);
  assert.equal(displays, 1); actual.dispose();

  const leased = createSqliteDbCache(); lease = leased.setAndAcquire(file, { close() { closes++; } });
  const pending = await runEvaluationResourceScope({ sqliteCache: leased, display }, async () => 'cannot publish yet')
    .then(() => assert.fail('an outstanding lease cannot become a completed report'), error => error);
  assert.equal(pending.cacheOwnershipReleased(), false); assert.equal(closes, 1);
  lease.release(); assert.equal(closes, 2); assert.equal(pending.cacheOwnershipReleased(), true);
  leased.dispose();
} finally {
  settled = true; if (lease) { try { lease.release(); } catch {} }
  if (owner) { try { owner.release(); } catch {} }
  await rmDirRecursive(root);
}
console.log('Evaluation original teardown/pending cache/report-publication controls authored; execution deferred.');
