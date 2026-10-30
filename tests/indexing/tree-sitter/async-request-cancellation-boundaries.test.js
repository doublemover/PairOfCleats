import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { registerHooks } from 'node:module';
import { treeSitterState } from '../../../src/lang/tree-sitter/state.js';
import { ensureChunkCache, resolveChunkCacheKey, storeCachedChunks } from '../../../src/lang/tree-sitter/chunking/cache.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { errorGraphIncludes } from '../../helpers/error-graph.js';

applyTestEnv();
const { dir } = await prepareIsolatedTestCacheDir('tree-sitter-request-cancellation');
const chunking = new URL('../../../src/lang/tree-sitter/chunking.js', import.meta.url).href;
const worker = new URL('../../../src/lang/tree-sitter/worker.js', import.meta.url).href;
const native = new URL('../../../src/lang/tree-sitter/native-runtime.js', import.meta.url).href;
const state = { acquire: async () => null, nativeCalls: 0, acquired: 0 };
globalThis.treeSitterCancellationFixture = state;
const hooks = registerHooks({ resolve(specifier, context, next) {
  if (context.parentURL?.startsWith(chunking) && specifier === './worker.js') return { url: 'tree-sitter-cancellation:worker', shortCircuit: true };
  if (context.parentURL?.startsWith(chunking) && specifier === './native-runtime.js') return { url: 'tree-sitter-cancellation:native', shortCircuit: true };
  return next(specifier, context);
}, load(url, context, next) {
  if (url === 'tree-sitter-cancellation:worker') return { format: 'module', shortCircuit: true, source: `
    export * from ${JSON.stringify(worker)};
    export const getTreeSitterWorkerPool=async(...args)=>{
      const state=globalThis.treeSitterCancellationFixture;state.acquired++;return state.acquire(...args);
    };` };
  if (url === 'tree-sitter-cancellation:native') return { format: 'module', shortCircuit: true, source: `
    export * from ${JSON.stringify(native)};
    import {getNativeTreeSitterParser as real} from ${JSON.stringify(native)};
    export const getNativeTreeSitterParser=(...args)=>{globalThis.treeSitterCancellationFixture.nativeCalls++;return real(...args);};` };
  return next(url, context);
} });
const gate = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const text = 'export function retainedCancellationFixture() { return 1; }\n';
const row = { start: 0, end: text.length, kind: 'FunctionDeclaration', name: 'worker-row' };
let caseId = 0;
try {
  const { buildTreeSitterChunksAsync } = await import(chunking);
  const { createFileProcessorForTest, createScannedFileEntry } = await import('../file-processor/file-processor-fixture.js');
  const options = controller => ({ abortSignal: controller.signal, treeSitterCacheKey: `request-${caseId++}`,
    treeSitter: { enabled: true, worker: { enabled: true, maxWorkers: 1 }, chunkCache: true, languagePasses: false } });
  const invoke = selected => buildTreeSitterChunksAsync({ text, ext: '.js', languageId: 'javascript', options: selected });
  const checkAborted = async (selected, work, before, original = null) => {
    await assert.rejects(work, error => error.name === 'AbortError' && error.code === 'ABORT_ERR'
      && (!original || errorGraphIncludes(error, original)));
    assert.equal(state.nativeCalls, before, 'cancelled request cannot perform synchronous native fallback');
    const key = resolveChunkCacheKey(selected, 'javascript');
    assert.equal(treeSitterState.chunkCache.has(key), false, 'cancelled worker result cannot become cached readiness');
  };
  // Warm cache is real, but an already cancelled request cannot read it.
  const warmController = new AbortController(), warm = options(warmController), cache = ensureChunkCache(warm);
  const warmKey = resolveChunkCacheKey(warm, 'javascript');
  storeCachedChunks({ cache: cache.cache, key: warmKey, chunks: [row], maxEntries: cache.maxEntries, sourceLength: text.length });
  assert.deepEqual(treeSitterState.chunkCache.get(warmKey), [row], 'the cancellation control starts with actual admitted warm rows');
  const hitsBeforeAbort = Number(treeSitterState.metrics.chunkCacheHits) || 0, nativeBeforeAbort = state.nativeCalls;
  warmController.abort(); const acquired = state.acquired;
  await assert.rejects(invoke(warm), { name: 'AbortError' }); assert.equal(state.acquired, acquired);
  assert.equal(Number(treeSitterState.metrics.chunkCacheHits) || 0, hitsBeforeAbort, 'pre-abort precedes even valid cache-hit admission');
  assert.equal(state.nativeCalls, nativeBeforeAbort); assert.deepEqual(treeSitterState.chunkCache.get(warmKey), [row]);
  treeSitterState.chunkCache.delete(resolveChunkCacheKey(warm, 'javascript'));
  for (const disposition of ['unavailable-after-admission', 'queue-full', 'wrapped-rejection', 'late-fulfillment']) {
    const controller = new AbortController(), selected = options(controller), before = state.nativeCalls;
    const entered = gate(), finish = gate(), failure = new Error('original worker rejection');
    state.acquire = async () => {
      if (disposition === 'unavailable-after-admission') { controller.abort(); return null; }
      if (disposition === 'queue-full') return { maxQueue: 1, get queueSize() { controller.abort(); return 1; } };
      return { maxQueue: 2, queueSize: 0, run: async (_payload, runOptions) => {
        assert.equal(runOptions.signal, controller.signal); entered.resolve(); await finish.promise;
        if (disposition === 'wrapped-rejection') throw failure; return [row];
      } };
    };
    const work = invoke(selected);
    if (disposition === 'wrapped-rejection' || disposition === 'late-fulfillment') {
      let terminal = false; work.then(() => { terminal = true; }, () => { terminal = true; });
      await entered.promise; controller.abort(); await new Promise(resolve => setImmediate(resolve));
      assert.equal(terminal, false, 'cancellation does not abandon the admitted worker promise'); finish.resolve();
    }
    await checkAborted(selected, work, before, disposition === 'wrapped-rejection' ? failure : null);
  }
  // Independent unsettled worker ownership is retained, never retried inline.
  let settled = false; const pending = Object.freeze(Object.assign(new Error('original native cleanup still pending'), {
    cacheOwnershipPending: true, cacheOwnershipReleased: () => settled }));
  const controller = new AbortController(), selected = options(controller), before = state.nativeCalls;
  state.acquire = async () => ({ run: async () => { throw pending; } });
  await assert.rejects(invoke(selected), error => errorGraphIncludes(error, pending));
  assert.equal(state.nativeCalls, before); assert.equal(pending.cacheOwnershipReleased(), false); settled = true;
  // Ordinary recoverable worker failure still reaches the actual native parser.
  const { initTreeSitterRuntime, preloadTreeSitterLanguages } = await import('../../../src/lang/tree-sitter.js');
  assert.equal(await initTreeSitterRuntime({ log() {} }), true);
  await preloadTreeSitterLanguages(['javascript'], { log() {}, parallel: false });
  state.acquire = async () => ({ run: async () => { throw new Error('ordinary recoverable worker failure'); } });
  const ordinary = await invoke(options(new AbortController()));
  assert.ok(state.nativeCalls > before); assert.ok(ordinary?.length > 0);
  // Exercise the real file processor -> parse policy -> managed JS/TS adapter
  // chain. No test directly injects a signal into the parser leaf here.
  for (const ext of ['.js', '.ts']) {
    const file = path.join(dir, 'managed' + ext); await fs.writeFile(file, text);
    const controller = new AbortController(), entered = gate(), finish = gate(); let observed;
    state.acquire = async () => ({ run: async (_payload, runOptions) => {
      observed = runOptions.signal; entered.resolve(); await finish.promise; return [row];
    } });
    const { processFile } = createFileProcessorForTest({ root: dir, languageOptions: { skipOnParseError: true,
      treeSitter: { enabled: true, languagePasses: false, worker: { enabled: true, maxWorkers: 1 } } } });
    const work = processFile(createScannedFileEntry({ abs: file, rel: 'managed' + ext, stat: await fs.stat(file) }), 0,
      { signal: controller.signal });
    await entered.promise; assert.equal(observed, controller.signal); const calls = state.nativeCalls;
    controller.abort(); finish.resolve();
    await assert.rejects(work, { name: 'AbortError' }); assert.equal(state.nativeCalls, calls);
    let confirmed = false;
    const original = Object.freeze(Object.assign(new Error('actual caller pending native cleanup'), {
      cacheOwnershipPending: true, cacheOwnershipReleased: () => confirmed }));
    state.acquire = async () => ({ run: async () => { throw original; } });
    await assert.rejects(processFile(createScannedFileEntry({ abs: file, rel: 'managed' + ext, stat: await fs.stat(file) }), 1,
      { signal: new AbortController().signal }), error => errorGraphIncludes(error, original));
    assert.equal(state.nativeCalls, calls, 'skipOnParseError cannot turn independently unsettled parser ownership into skipped success');
    assert.equal(original.cacheOwnershipReleased(), false); confirmed = true;
  }
  const file = path.join(dir, 'managed.js'), entry = createScannedFileEntry({ abs: file, rel: 'managed.js', stat: await fs.stat(file) });
  const first = new AbortController(), queued = new AbortController(), entered = gate(), finish = gate(), waiting = gate();
  let dispatches = 0;
  state.acquire = async () => ({ run: async () => { dispatches++; entered.resolve(); await finish.promise; return [row]; } });
  const { processFile } = createFileProcessorForTest({ root: dir, languageOptions: { skipOnParseError: true,
    treeSitter: { enabled: true, languagePasses: false, worker: { enabled: true, maxWorkers: 1 } } } });
  const active = processFile(entry, 0, { signal: first.signal }); await entered.promise;
  const behind = processFile(entry, 1, { signal: queued.signal,
    onStage: stage => { if (stage === 'tree-sitter:start') waiting.resolve(); } });
  await waiting.promise; queued.abort(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(dispatches, 1, 'queued file cancellation cannot start a second parser task');
  const failures = [assert.rejects(active, { name: 'AbortError' }), assert.rejects(behind, { name: 'AbortError' })];
  first.abort(); finish.resolve(); await Promise.all(failures);
  assert.equal(dispatches, 1);
} finally { hooks.deregister(); delete globalThis.treeSitterCancellationFixture; treeSitterState.chunkCache.clear();
  await fs.rm(dir, { recursive: true, force: true }); }
console.log('Real managed parser callers preserve request cancellation across cache, pool, queue, worker fulfillment and fallback boundaries.');
