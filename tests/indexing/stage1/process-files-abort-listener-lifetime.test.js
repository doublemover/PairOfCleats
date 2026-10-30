import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { processFiles } from '../../../src/index/build/indexer/steps/process-files.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const options = (signal, overrides = {}) => ({ mode: 'records', runtime: { root: process.cwd() }, discovery: null,
  outDir: process.cwd(), entries: [], contextWin: 0, timing: {}, crashLogger: { enabled: true, updatePhase() {}, updateFile() {}, logError() {} },
  state: { chunks: [] }, cacheReporter: { report() {} }, seenFiles: new Set(), incrementalState: null,
  relationsEnabled: false, fileTextCache: null, abortSignal: signal, ...overrides });
for (const nonempty of [false, true]) {
  const controller = new AbortController(), reason = new Error('exact original external cancellation');
  const unrelated = () => {};
  controller.signal.addEventListener('abort', unrelated);
  controller.abort(reason);
  const before = getEventListeners(controller.signal, 'abort');
  for (let n = 0; n < 16; n++) {
    let caught;
    try { await processFiles(options(controller.signal, nonempty ? { entries: [{ rel: 'input.js' }] } : {})); }
    catch (error) { caught = error; }
    assert.equal(caught?.name, 'AbortError'); assert.equal(caught.code, 'ABORT_ERR'); assert.equal(caught.cause, reason);
    assert.deepEqual(getEventListeners(controller.signal, 'abort'), before, 'rejected admission preserves exactly the unrelated listener baseline');
  }
  controller.signal.removeEventListener('abort', unrelated);
}
for (const failAt of ['logger', 'startup']) {
  for (const failure of [null, false, 0, '', Object.freeze(new Error('original early startup failure'))]) {
    const controller = new AbortController(), unrelated = () => {};
    controller.signal.addEventListener('abort', unrelated);
    const before = getEventListeners(controller.signal, 'abort');
    const settings = failAt === 'logger' ? { crashLogger: { updatePhase() { throw failure; } } }
      : { entries: [{ rel: 'input.js' }], runtime: { root: process.cwd(), telemetry: {
        clearDurationHistogram() { throw failure; }
      } } };
    let rejected = false;
    await processFiles(options(controller.signal, settings)).then(() => {}, error => { rejected = true; assert.equal(error, failure); });
    assert.equal(rejected, true); assert.deepEqual(getEventListeners(controller.signal, 'abort'), before);
    controller.abort(); assert.deepEqual(getEventListeners(controller.signal, 'abort'), before);
    controller.signal.removeEventListener('abort', unrelated);
  }
}
const healthy = new AbortController();
assert.equal((await processFiles(options(healthy.signal))).stageElided, true);
assert.deepEqual(getEventListeners(healthy.signal, 'abort'), []);
healthy.abort(); assert.deepEqual(getEventListeners(healthy.signal, 'abort'), []);
console.log('Actual public Stage1 releases exact external listeners for repeated pre-abort and early initialization failures.');
