import assert from 'node:assert/strict';
import { runSearchByMode } from '../../../src/retrieval/cli/search-runner.js';
const deferred = () => { let resolve; const promise = new Promise(next => { resolve = next; }); return { promise, resolve }; };
const slow = deferred(), entered = deferred();
const primary = new Error('prose failed');
const secondary = new Error('code failed after prose');
let finished = false, callerDisposed = false, observed;
const pending = runSearchByMode({
  runProse: true, runCode: true,
  searchPipeline: async (_idx, mode) => {
    if (mode === 'prose') throw primary;
    entered.resolve();
    await slow.promise;
    assert.equal(callerDisposed, false, 'caller cleanup cannot run while a sibling uses its backend');
    finished = true;
    throw secondary;
  }
}).catch(error => { observed = error; }).finally(() => { callerDisposed = true; });
await entered.promise;
await Promise.resolve();
assert.equal(callerDisposed, false);
slow.resolve();
await pending;
assert.equal(finished, true);
assert.equal(observed, primary);
assert.deepEqual(observed.siblingErrors, [secondary]);
const success = await runSearchByMode({ runCode: true, searchPipeline: async (_idx, mode) => [{ mode }] });
assert.deepEqual(success.codeHits, [{ mode: 'code' }]);
console.log('search mode failure drain passed');
