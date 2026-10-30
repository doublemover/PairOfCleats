import assert from 'node:assert/strict';
import { createDocumentProgressRunner, runWithConcurrency } from '../../../src/integrations/tooling/providers/lsp/hover-types/concurrency.js';

for (const [total, failAt] of [[1, 1], [19, 1], [20, 1], [20, 20], [21, 1], [21, 20], [21, 21]]) {
  const primary = Object.freeze(new Error(`document failure ${total}/${failAt}`));
  const progress = [];
  const run = createDocumentProgressRunner({ total, now: () => 0,
    worker: async value => { if (value === failAt) throw primary; },
    onProgress: value => { progress.push(value.processed); } });
  for (let index = 1; index < failAt; index++) await run(index);
  await assert.rejects(run(failAt), error => error === primary,
    'document failure remains terminal whether progress is disabled, due or suppressed');
  if (total === 21 && failAt === 21) assert.deepEqual(progress, [20, 21]);
}
const documentFailure = Object.freeze(new Error('document failure')), logFailure = Object.freeze(new Error('logger failure'));
const logged = createDocumentProgressRunner({ total: 20, now: () => 0,
  worker: async index => { if (index === 20) throw documentFailure; }, onProgress: () => { throw logFailure; } });
for (let index = 1; index < 20; index++) await logged(index);
let combined;
try { await logged(20); } catch (error) { combined = error; }
assert.equal(combined.cause, documentFailure);
assert.ok(combined.errors.includes(logFailure));

for (const abort of [false, true]) {
  const caller = new AbortController(), first = Promise.withResolvers(), second = Promise.withResolvers();
  const bothStarted = Promise.withResolvers();
  const started = [], ended = [];
  let active = 0, highWater = 0, terminal = false;
  const primary = Object.freeze(new Error('primary worker failure'));
  const batch = runWithConcurrency(Array.from({ length: 12 }, (_, index) => index), 2, async index => {
    started.push(index); highWater = Math.max(highWater, ++active);
    if (started.length === 2) bothStarted.resolve();
    try {
      await (index === 0 ? first.promise : second.promise);
      if (index === 0 && !abort) throw primary;
    } finally { active -= 1; ended.push(index); }
  }, { signal: caller.signal });
  let failure;
  const observed = batch.catch(error => { failure = error; }).finally(() => { terminal = true; });
  await bothStarted.promise;
  if (abort) caller.abort();
  first.resolve(); await Promise.resolve(); await Promise.resolve();
  assert.equal(terminal, false, 'batch remains owned while an admitted sibling is active');
  assert.equal(active, 1);
  second.resolve(); await observed;
  assert.deepEqual(started, [0, 1], 'no queued document starts after failure/cancellation');
  assert.deepEqual(ended.sort(), [0, 1]); assert.equal(highWater, 2); assert.equal(active, 0);
  if (abort) assert.equal(failure.name, 'AbortError'); else assert.equal(failure, primary);
}
let active = 0, peak = 0;
const count = [];
await runWithConcurrency([0, 1, 2, 3], 2, async index => {
  peak = Math.max(peak, ++active); await Promise.resolve(); count.push(index); active -= 1;
});
assert.deepEqual(count.sort(), [0, 1, 2, 3]); assert.equal(peak, 2);
console.log('LSP progress preserves original failures; document batches stop admission and join actual siblings before unwind.');
