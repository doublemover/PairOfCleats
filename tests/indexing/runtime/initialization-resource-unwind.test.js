import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { runNode } from '../../helpers/run-node.js';
import { applyTestEnv } from '../../helpers/test-env.js';

const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-init-unwind-'));
try {
  const shim = path.join(dir, 'record-resources.mjs');
  const runner = path.join(dir, 'run.mjs');
  const recordPath = path.join(dir, 'resources.json');
  const runtimeUrl = pathToFileURL(path.resolve('src/index/build/runtime/runtime.js')).href;
  await fs.writeFile(path.join(dir, '.pairofcleats.json'), JSON.stringify({
    indexing: { embeddings: { enabled: false, mode: 'off' }, treeSitter: { enabled: false }, scm: { provider: 'none' } }
  }));
  await fs.writeFile(shim, `
    import { registerHooks } from 'node:module';
    globalThis.__resourceEvents = [];
    registerHooks({ load(url, context, next) {
      if (url.endsWith('/index/build/runtime/workers.js')) return { format: 'module', shortCircuit: true, source:
        'import * as actual from ' + JSON.stringify(url + '?actual') + '; export * from ' + JSON.stringify(url + '?actual') + ';' +
        'export const createRuntimeWorkerPools = async () => { globalThis.__resourceEvents.push("pools:acquired"); return { workerPools: { destroy: async () => { globalThis.__resourceEvents.push("pools:closed"); throw new Error("controlled pool cleanup failure"); } }, workerPool: null, quantizePool: null }; };' +
        'export const createRuntimeQueues = input => { const result = actual.createRuntimeQueues(input); for (const [name, queue] of Object.entries(result.queues)) { if(!queue) continue; const clear = queue.clear.bind(queue); queue.clear = () => { globalThis.__resourceEvents.push("queue:" + name); clear(); }; } return result; };'
      };
      if (url.endsWith('/concurrency/scheduler-core.js')) return { format: 'module', shortCircuit: true, source:
        'import * as actual from ' + JSON.stringify(url + '?actual') + '; export * from ' + JSON.stringify(url + '?actual') + ';' +
        'export const createBuildScheduler = input => { const scheduler = actual.createBuildScheduler(input); const shutdown = scheduler.shutdown.bind(scheduler); scheduler.shutdown = async (...args) => { globalThis.__resourceEvents.push("scheduler:closed"); return shutdown(...args); }; return scheduler; };'
      };
      if (url.endsWith('/index/build/runtime/receipt.js')) return { format: 'module', shortCircuit: true, source:
        'export * from ' + JSON.stringify(url + '?actual') + '; export const refreshRuntimeReceipt = async () => { globalThis.__resourceEvents.push("receipt:failed"); throw Object.assign(new Error("controlled final receipt failure"), { code: "ENOSPC" }); };'
      };
      return next(url, context);
    }});
  `);
  await fs.writeFile(runner, `
    import fs from 'node:fs/promises';
    import { createBuildRuntime } from ${JSON.stringify(runtimeUrl)};
    let failure;
    try { await createBuildRuntime({ root: process.env.POC_UNWIND_ROOT, argv: { stage: 'stage2', threads: 1 }, rawArgv: [] }); }
    catch (error) { failure = { code: error.code, message: error.message, cleanupErrors: error.cleanupErrors?.map(item => item.message) }; }
    await fs.writeFile(process.env.POC_UNWIND_RECORD, JSON.stringify({ failure, events: globalThis.__resourceEvents }));
  `);
  const env = applyTestEnv({ syncProcess: false, cacheRoot: path.join(dir, 'cache'), extraEnv: {
    POC_UNWIND_ROOT: dir, POC_UNWIND_RECORD: recordPath, PAIROFCLEATS_TRUSTED_CONFIG: null
  } });
  runNode(['--import', pathToFileURL(shim).href, runner], 'final receipt failure resource unwind', process.cwd(), env, { stdio: 'pipe', timeoutMs: 15000 });
  const result = JSON.parse(await fs.readFile(recordPath, 'utf8'));
  assert.equal(result.failure.code, 'ENOSPC');
  assert.match(result.failure.cleanupErrors.join(' '), /pool cleanup failure/);
  assert.equal(result.events.filter(event => event === 'pools:closed').length, 1);
  assert.ok(result.events.indexOf('receipt:failed') < result.events.indexOf('pools:closed'));
  assert.ok(result.events.indexOf('pools:closed') < result.events.indexOf('scheduler:closed'));
  assert.ok(result.events.some(event => event.startsWith('queue:')));
  assert.equal(result.events.at(-1), 'scheduler:closed', 'reverse unwind reaches the earliest acquired owner after cleanup failure');
} finally { await fs.rm(dir, { recursive: true, force: true }); }
console.log('initialization resource unwind test passed');
