import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { runNode } from '../../helpers/run-node.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { createRequire } from 'node:module';

const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-init-unwind-'));
try {
  const shim = path.join(dir, 'record-resources.mjs');
  const runner = path.join(dir, 'run.mjs');
  const recordPath = path.join(dir, 'resources.json');
  const workerPath = path.join(dir, 'held-worker.mjs');
  const piscinaUrl = pathToFileURL(createRequire(import.meta.url).resolve('piscina')).href;
  await fs.writeFile(workerPath, 'export default input => input.hold ? new Promise(() => {}) : input;');
  const runtimeUrl = pathToFileURL(path.resolve('src/index/build/runtime/runtime.js')).href;
  const accessUrl = pathToFileURL(path.resolve('src/shared/storage/access.js')).href;
  const rootsUrl = pathToFileURL(path.resolve('src/shared/cache-roots.js')).href;
  await fs.writeFile(path.join(dir, '.pairofcleats.json'), JSON.stringify({
    quality: 'fast', threads: 1,
    indexing: { embeddings: { enabled: false, mode: 'off' }, treeSitter: { enabled: false }, scm: { provider: 'none' },
      platformPresets: { startupCalibration: false } }
  }));
  await fs.writeFile(shim, `
    import { registerHooks } from 'node:module';
    import Piscina from ${JSON.stringify(piscinaUrl)};
    globalThis.__resourceEvents = [];
    globalThis.__createUnwindPools = async () => {
      const pool = new Piscina({filename:process.env.POC_UNWIND_WORKER,minThreads:1,maxThreads:1});
      globalThis.__unwindNativePool = pool;
      try { await pool.run({ready:true}); }
      catch(error){await pool.destroy();throw error;}
      globalThis.__unwindWorkSettled = false;
      const pending = pool.run({hold:true}).then(() => {globalThis.__unwindWorkSettled=true;},
        () => {globalThis.__unwindWorkSettled=true;});
      globalThis.__resourceEvents.push('pools:acquired');
      return {workerPool:null,quantizePool:null,workerPools:{destroy:async()=>{
        await pool.destroy(); await pending;
        globalThis.__resourceEvents.push('pools:closed');
        if(process.env.POC_UNWIND_CLEANUP_FAIL==='1')throw new Error('controlled pool cleanup failure');
      }}};
    };
    registerHooks({ load(url, context, next) {
      if (url.endsWith('/index/build/runtime/workers.js')) return { format: 'module', shortCircuit: true, source:
        'import * as actual from ' + JSON.stringify(url + '?actual') + '; export * from ' + JSON.stringify(url + '?actual') + ';' +
        'export const createRuntimeWorkerPools = globalThis.__createUnwindPools;' +
        'export const createRuntimeQueues = input => { const result = actual.createRuntimeQueues(input); for (const [name, queue] of Object.entries(result.queues)) { if(!queue) continue; const clear = queue.clear.bind(queue); queue.clear = () => { globalThis.__resourceEvents.push("queue:" + name); clear(); }; } return result; };'
      };
      if (url.endsWith('/concurrency/scheduler-core.js')) return { format: 'module', shortCircuit: true, source:
        'import * as actual from ' + JSON.stringify(url + '?actual') + '; export * from ' + JSON.stringify(url + '?actual') + ';' +
        'export const createBuildScheduler = input => { const scheduler = actual.createBuildScheduler(input); const shutdown = scheduler.shutdown.bind(scheduler); scheduler.shutdown = async (...args) => { globalThis.__resourceEvents.push("scheduler:closed"); return shutdown(...args); }; return scheduler; };'
      };
      if (url.endsWith('/index/build/runtime/receipt.js')) return { format: 'module', shortCircuit: true, source:
        'export * from ' + JSON.stringify(url + '?actual') + '; export const refreshRuntimeReceipt = async () => { globalThis.__resourceEvents.push("receipt:failed"); globalThis.__initPrimaryError = Object.freeze(Object.assign(new Error("controlled final receipt failure"), { code: "ENOSPC" })); throw globalThis.__initPrimaryError; };'
      };
      if (url.endsWith('/index/build/build-state/runtime.js')) return { format: 'module', shortCircuit: true, source:
        'import * as actual from ' + JSON.stringify(url + '?actual') + '; export * from ' + JSON.stringify(url + '?actual') + ';' +
        'import path from "node:path"; import { inspectStorageAccess } from ' + ${JSON.stringify(JSON.stringify(accessUrl))} + ';' +
        'import { getCacheRoot, getApplicationHome } from ' + ${JSON.stringify(JSON.stringify(rootsUrl))} + ';' +
        'export const persistRuntimeAttempt = async (...args) => { if (args[2]?.lifecycle === "failed") globalThis.__failureReceiptProtected = (await inspectStorageAccess(getCacheRoot(), { coordinationRoot: path.join(getApplicationHome(), "state", "storage-access") })).protected; return actual.persistRuntimeAttempt(...args); };'
      };
      return next(url, context);
    }});
  `);
  await fs.writeFile(runner, `
    import fs from 'node:fs/promises';
    import path from 'node:path';
    import { createBuildRuntime } from ${JSON.stringify(runtimeUrl)};
    import { inspectStorageAccess } from ${JSON.stringify(accessUrl)};
    import { getCacheRoot, getApplicationHome } from ${JSON.stringify(rootsUrl)};
    let failure;
    try { await createBuildRuntime({ root: process.env.POC_UNWIND_ROOT, argv: { stage: 'stage2', threads: 1 }, rawArgv: [] }); }
    catch (error) {
      const pending = [error], seen = new Set(); let primaryRetained = false;
      while (pending.length) { const item = pending.pop(); if (!item || seen.has(item)) continue; seen.add(item);
        if (item === globalThis.__initPrimaryError) primaryRetained = true;
        pending.push(item.cause, ...(Array.isArray(item.errors) ? item.errors : [])); }
      failure = { code: error.code, message: error.message, cleanupErrors: error.cleanupErrors?.map(item => item.message),
        pending: error.cacheOwnershipPending === true, primaryRetained };
    }
    const protectedAfter = (await inspectStorageAccess(getCacheRoot(), { coordinationRoot: path.join(getApplicationHome(), 'state', 'storage-access') })).protected;
    await fs.writeFile(process.env.POC_UNWIND_RECORD, JSON.stringify({ failure, events: globalThis.__resourceEvents,
      protectedAfter, failureReceiptProtected: globalThis.__failureReceiptProtected,
      nativeWorkers:globalThis.__unwindNativePool.threads.length,nativeQueue:globalThis.__unwindNativePool.queueSize,
      nativeWorkSettled:globalThis.__unwindWorkSettled }));
  `);
  for (const failCleanup of [true, false]) {
    const variant = failCleanup ? 'pending' : 'closed';
    const env = applyTestEnv({ syncProcess: false, cacheRoot: path.join(dir, variant, 'cache'), extraEnv: {
      POC_UNWIND_ROOT: dir, POC_UNWIND_RECORD: recordPath, POC_UNWIND_WORKER: workerPath, PAIROFCLEATS_TRUSTED_CONFIG: null,
      PAIROFCLEATS_HOME: path.join(dir, variant, 'home'), POC_UNWIND_CLEANUP_FAIL: failCleanup ? '1' : '0'
    } });
    runNode(['--import', pathToFileURL(shim).href, runner], 'final receipt failure resource unwind', process.cwd(), env, { stdio: 'pipe', timeoutMs: 9000 });
    const result = JSON.parse(await fs.readFile(recordPath, 'utf8'));
    assert.equal(result.failure.code, 'ENOSPC');
    assert.equal(result.failure.primaryRetained, true, 'frozen primary error survives cleanup and failure recording');
    assert.equal(result.nativeWorkers, 0); assert.equal(result.nativeQueue, 0);
    assert.equal(result.nativeWorkSettled, true, 'actual Piscina work and threads settle before the failed runtime returns');
    if (failCleanup) assert.match(result.failure.cleanupErrors.join(' '), /pool cleanup failure/);
    assert.equal(result.failure.pending, failCleanup);
    assert.equal(result.protectedAfter, failCleanup);
    assert.equal(result.failureReceiptProtected, true, 'category remains pinned during failure receipt persistence after unwind');
    assert.equal(result.events.filter(event => event === 'pools:closed').length, 1);
    assert.ok(result.events.indexOf('receipt:failed') < result.events.indexOf('pools:closed'));
    assert.ok(result.events.indexOf('pools:closed') < result.events.indexOf('scheduler:closed'));
    assert.ok(result.events.some(event => event.startsWith('queue:')));
    assert.equal(result.events.at(-1), 'scheduler:closed', 'reverse unwind reaches the earliest acquired owner after cleanup failure');
  }
} finally { await fs.rm(dir, { recursive: true, force: true }); }
console.log('initialization resource unwind test passed');
