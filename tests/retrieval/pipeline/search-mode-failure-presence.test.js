import assert from 'node:assert/strict';
import { runSearchByMode } from '../../../src/retrieval/cli/search-runner.js';

for (const primary of [undefined, null, false, 0, '', Object.freeze(new Error('frozen primary'))]) {
  const gate = Promise.withResolvers();
  let siblingSettled = false;
  const result = runSearchByMode({ runCode: true, runProse: true,
    searchPipeline: async (_idx, mode) => {
      if (mode === 'code') throw primary;
      await gate.promise; siblingSettled = true; return [];
    } });
  let rejected = false, received;
  const observed = result.catch(error => { rejected = true; received = error; });
  await Promise.resolve();
  assert.equal(siblingSettled, false);
  gate.resolve(); await observed;
  assert.equal(rejected, true, 'falsey failure presence is independent of its value');
  assert.equal(received, primary); assert.equal(siblingSettled, true, 'all owned modes settle before reporting failure');
}
const first = Object.freeze(new Error('first mode')), second = Object.freeze(new Error('second mode'));
let failure;
try { await runSearchByMode({ runCode: true, runProse: true,
  searchPipeline: async (_idx, mode) => { throw mode === 'prose' ? first : second; } }); }
catch (error) { failure = error; }
assert.ok(failure instanceof AggregateError);
assert.equal(failure.cause, first);
assert.deepEqual(failure.siblingErrors, [second]);
try { await runSearchByMode({ runCode: true, runProse: true, searchPipeline: async () => { throw 0; } }); }
catch (error) { failure = error; }
assert.deepEqual(failure.siblingErrors, [0], 'separate failed modes remain independent even with the same falsey reason');
console.log('Concurrent search preserves falsey/frozen original failures and joins sibling work before unwind.');
