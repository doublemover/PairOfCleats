import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { registerHooks, createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { setImmediate as tick } from 'node:timers/promises';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { createBuildScheduler } from '../../../src/shared/concurrency/scheduler-core.js';
import { projectFileAnalysisInput } from '../../../src/index/build/workers/file-analysis-contract.js';
import { createTokenizationContext } from '../../../src/index/build/tokenization.js';
import { createScmFileProcessorContext } from '../file-processor/scm-file-processor-test-helper.js';

const selected = process.env.PAIROFCLEATS_TEST_ID?.split('indexing/workers/thread-task-facade-cancellation/')[1];
assert.ok(['single', 'batch', 'quantize', 'analysis'].includes(selected));
const { dir } = await prepareIsolatedTestCacheDir(`facade-cancellation-${selected}`);
applyTestEnv({ cacheRoot: path.join(dir, 'cache'), embeddings: 'off' });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const assignment = deferred(), terminating = deferred(), permitExit = deferred();
const actualPiscina = pathToFileURL(createRequire(import.meta.url).resolve('piscina')).href;
const hooks = registerHooks({ resolve(specifier, context, next) {
  return specifier === 'piscina' && context.parentURL?.endsWith('/index/build/workers/pool.js')
    ? { url: 'task-owner:observed-piscina', shortCircuit: true } : next(specifier, context);
}, load(url, context, next) {
  if (url !== 'task-owner:observed-piscina') return next(url, context);
  return { format: 'module', shortCircuit: true, source: `import Actual from ${JSON.stringify(actualPiscina)};
    export default class Observed extends Actual { constructor(options) { let instance;
      super({...options,loadBalancer(task,workers){const selected=options.loadBalancer(task,workers);
        if(selected)globalThis.__threadFacadeAssignment?.(instance,selected.id,task.name);return selected;}});instance=this; } }` };
} });
const control = new AbortController(), reason = new Error('original facade request cancellation');
let original, nativeTerminate, originalId, exitCount = 0, observed = false, pool, parent, finished = false;
const phases = [], scheduler = createBuildScheduler({ cpuTokens: 1, memoryTokens: 1, maxInFlightBytes: 1024 });
globalThis.__threadFacadeAssignment = (raw, id, name) => {
  if (observed) return;
  observed = true; original = raw.threads.find(worker => worker.threadId === id); assert.ok(original);
  originalId = id; nativeTerminate = original.terminate;
  original.once('exit', () => { exitCount++; phases.push({ phase: 'original-exit', atMs: performance.now() }); });
  original.terminate = function () { terminating.resolve(); return permitExit.promise.then(() => nativeTerminate.call(original)); };
  phases.push({ phase: 'actual-dispatch', name, id, atMs: performance.now() }); assignment.resolve();
  queueMicrotask(() => control.abort(reason));
};
try {
  const { createIndexerWorkerPool } = await import('../../../src/index/build/workers/pool.js');
  pool = await createIndexerWorkerPool({ config: { enabled: true, maxWorkers: 1, idleTimeoutMs: 60000 },
    dictWords: new Set(['alpha']), dictConfig: {}, postingsConfig: {}, log() {} });
  assert.ok(pool && pool.stats().backend === 'worker');
  const item = { text: 'alpha beta', mode: 'code', ext: '.js', languageId: 'javascript' };
  const text = 'export function example(value) { return value + 1; }\n';
  const file = path.join(dir, 'input.js'); await fs.writeFile(file, text);
  const context = createScmFileProcessorContext({ abs: file, rel: path.relative(process.cwd(), file),
    relKey: path.relative(process.cwd(), file).replaceAll('\\', '/'), ext: '.js', text, fileStat: await fs.stat(file),
    scmProvider: null, scmProviderImpl: null, relationsEnabled: true, lintEnabled: true,
    tokenContext: createTokenizationContext({ dictWords: new Set(), dictConfig: {}, postingsConfig: {} }) });
  const { payload } = projectFileAnalysisInput(context); assert.ok(payload);
  const invoke = () => selected === 'single' ? pool.tokenizeChunk(item, { signal: control.signal })
    : selected === 'batch' ? pool.tokenizeBatch({ items: [item, { ...item, text: 'beta gamma' }] }, { signal: control.signal })
      : selected === 'quantize' ? pool.runQuantize({ vectors: [[0, 1], [1, 0]] }, { signal: control.signal })
        : pool.analyzeFile(payload, { signal: control.signal });
  parent = scheduler.schedule('original-facade', { cpu: 1, mem: 1, bytes: 1024 }, invoke).finally(() => { finished = true; });
  const rejected = assert.rejects(parent, error => error.name === 'AbortError');
  await assignment.promise; await terminating.promise; await tick();
  assert.equal(exitCount, 0); assert.equal(finished, false);
  assert.equal(pool.stats().activeTasks, 1); assert.equal(pool.stats().dispatchedTasks, 1);
  assert.equal(scheduler.stats().tokens.cpu.used, 1); assert.equal(scheduler.stats().tokens.mem.used, 1);
  assert.equal(scheduler.stats().activity.inFlightBytes, 1024);
  if (selected !== 'quantize') assert.equal(pool.stats().memoryPressure.languageThrottle.activeByLanguage.javascript, 1);
  let peerEntered = false;
  const peer = scheduler.schedule('competing-facade', { cpu: 1, mem: 1, bytes: 1024 }, () => { peerEntered = true; });
  await tick(); assert.equal(peerEntered, false);
  phases.push({ phase: 'request-canceled-actual-exit-held', atMs: performance.now(), originalId,
    active: pool.stats().activeTasks, dispatched: pool.stats().dispatchedTasks,
    cpu: scheduler.stats().tokens.cpu.used, bytes: scheduler.stats().activity.inFlightBytes });
  permitExit.resolve(); await rejected; await peer;
  assert.equal(exitCount, 1); assert.equal(pool.stats().activeTasks, 0); assert.equal(pool.stats().dispatchedTasks, 0);
  assert.equal(scheduler.stats().activity.inFlightBytes, 0);
  const healthy = await pool.tokenizeChunk(item);
  assert.ok(healthy?.tokens?.length > 0);
  assert.ok(pool.pool.threads.every(worker => worker.threadId !== originalId), 'a later healthy task cannot be mistaken for the canceled original generation');
  console.log(JSON.stringify({ selected, phases, completed: pool.pool.completed,
    qualification: 'actual supported task facade, public Piscina dispatch and original Worker exit; deliberate termination gate, no natural latency claim' }));
} finally {
  control.abort(reason); permitExit.resolve(); if (original && nativeTerminate) original.terminate = nativeTerminate;
  await parent?.catch(() => {}); await pool?.destroy(); await scheduler.shutdown({ awaitRunning: true, timeoutMs: 1000 });
  hooks.deregister(); delete globalThis.__threadFacadeAssignment; await fs.rm(dir, { recursive: true, force: true });
}
