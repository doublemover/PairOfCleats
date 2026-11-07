import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { registerHooks } from 'node:module';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const events = [];
let failureAt = 'preload';
const original = new Error('original setup failure');
globalThis.__stage1Setup = { events, original, fail: phase => failureAt === phase };
const owners = new Map([
  ['perf-event-log.js', `export const createPerfEventLogger=async()=>({close:async()=>globalThis.__stage1Setup.events.push('logger.close')});
    export const createHeavyFilePerfAggregator=({logger})=>logger;`],
  ['incremental/verified-replay.js', `export const createSemanticReplayVerificationContext=()=>({clear(){globalThis.__stage1Setup.events.push('replay.clear')}});`],
  ['incremental/semantic-cache-dependencies.js', 'export const createSemanticCacheDependencySignatures=()=>({});'],
  ['incremental/file-completion.js', `export const preloadFileCompletions=async()=>{
    if(globalThis.__stage1Setup.fail('preload'))throw globalThis.__stage1Setup.original;return new Set();};`],
  ['tree-sitter-scheduler/runner.js', `export const runTreeSitterScheduler=async()=>({
    stats(){globalThis.__stage1Setup.events.push('scheduler.acquired');throw globalThis.__stage1Setup.original;},
    async close(){await Promise.resolve();globalThis.__stage1Setup.events.push('scheduler.close')}});`]
]);
const modules = [...owners];
const hook = registerHooks({ resolve(specifier, context, next) {
  const resolved = next(specifier, context);
  if (context.parentURL?.endsWith('/steps/process-files.js')) {
    const index = modules.findIndex(([suffix]) => resolved.url.endsWith('/index/build/' + suffix));
    if (index >= 0) return { url: 'stage1-setup:' + index, shortCircuit: true };
  }
  return resolved;
}, load(url, context, next) {
  if (url.startsWith('stage1-setup:')) return { format: 'module', shortCircuit: true, source: modules[Number(url.split(':')[1])][1] };
  return next(url, context);
} });
try {
  const { processFiles } = await import('../../../src/index/build/indexer/steps/process-files.js');
  for (failureAt of ['preload', 'scheduler-stats']) {
    events.length = 0;
    const controller = new AbortController(), before = getEventListeners(controller.signal, 'abort').length;
    const incrementalState = { enabled: true, manifest: { dependencySignatures: {} }, bundleDir: process.cwd() };
    const runtime = { root: process.cwd(), languageOptions: {}, fileConcurrency: 1, ioConcurrency: 1, cpuConcurrency: 1,
      cacheWriterLease: {}, semanticPolicy: { enabled: true, storage: { decodedCacheBytes: 1024 } } };
    await assert.rejects(processFiles({ mode: 'code', runtime, entries: [{ abs: 'owned.txt', rel: 'owned.txt', ext: '.txt' }],
      outDir: process.cwd(), timing: {}, crashLogger: { updatePhase() {} }, state: { chunks: [], semanticDiskAccount: {} },
      cacheReporter: {}, seenFiles: new Set(), incrementalState, abortSignal: controller.signal }), error => error === original);
    assert.deepEqual(events, failureAt === 'preload' ? ['logger.close', 'replay.clear']
      : ['scheduler.acquired', 'logger.close', 'scheduler.close', 'replay.clear']);
    assert.equal(incrementalState.semanticReplayVerification, null);
    assert.equal(getEventListeners(controller.signal, 'abort').length, before);
  }
} finally { hook.deregister(); delete globalThis.__stage1Setup; }
console.log('Actual Stage1 setup failures settle acquired logger/scheduler and clear replay ownership.');
