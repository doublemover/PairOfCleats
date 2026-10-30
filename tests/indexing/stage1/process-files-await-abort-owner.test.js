import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { getEventListeners } from 'node:events';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const hooks = registerHooks({ load(url, context, next) {
  const loaded = next(url, context);
  if (!url.endsWith('/process-files/runtime-state.js')) return loaded;
  const original = typeof loaded.source === 'string' ? loaded.source : Buffer.from(loaded.source).toString('utf8');
  const source = original.replace('export const loadExtractedProseYieldProfileState = async ', 'const originalLoadExtractedProseYieldProfileState = async ');
  assert.notEqual(source, original);
  return { ...loaded, source: source + '\nexport const loadExtractedProseYieldProfileState=options=>globalThis.__stage1AwaitFailure ? globalThis.__stage1AwaitFailure() : originalLoadExtractedProseYieldProfileState(options);\n' };
} });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
try {
  const { processFiles } = await import('../../../src/index/build/indexer/steps/process-files.js');
  for (const failure of [null, false, 0, '', Object.freeze(new Error('original awaited startup rejection'))]) {
    const controller = new AbortController(), unrelated = () => {}, entered = deferred(), release = deferred();
    controller.signal.addEventListener('abort', unrelated);
    const baseline = getEventListeners(controller.signal, 'abort');
    globalThis.__stage1AwaitFailure = async () => { entered.resolve(); await release.promise; throw failure; };
    const operation = processFiles({ mode: 'extracted-prose', runtime: { root: process.cwd() }, entries: [{ rel: 'input.pdf' }],
      outDir: process.cwd(), timing: {}, state: { chunks: [] }, crashLogger: { updatePhase() {} }, abortSignal: controller.signal });
    let rejected = false;
    const result = operation.then(() => {}, error => { rejected = true; assert.equal(error, failure); });
    await entered.promise;
    assert.equal(getEventListeners(controller.signal, 'abort').length, baseline.length + 1);
    release.resolve(); await result;
    assert.equal(rejected, true); assert.deepEqual(getEventListeners(controller.signal, 'abort'), baseline);
    controller.signal.removeEventListener('abort', unrelated);
  }
} finally { hooks.deregister(); delete globalThis.__stage1AwaitFailure; }
console.log('Actual public Stage1 forwarding lifetime spans an awaited startup rejection before the nested stage resource owner.');
