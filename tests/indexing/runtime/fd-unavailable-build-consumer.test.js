import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { setImmediate as tick } from 'node:timers/promises';
import { createBuildRuntime } from '../../../src/index/build/runtime/runtime.js';
import { teardownRuntime } from '../../../src/integrations/core/build-index/runtime.js';
import { createFastIndexingTestConfig } from '../../helpers/fast-indexing-config.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { createBuildScheduler } from '../../../src/shared/concurrency/scheduler-core.js';
import { createRuntimeQueues } from '../../../src/index/build/runtime/workers.js';
const { dir } = await prepareIsolatedTestCacheDir('fd-unavailable-build-consumer');
const root = path.join(dir, 'repo'); await fs.mkdir(root); await fs.writeFile(path.join(root, 'a.js'), 'export const a = 1;');
applyTestEnv({ cacheRoot: path.join(dir, 'cache'), embeddings: 'off', extraEnv: {
  PAIROFCLEATS_SCHEDULER_MAX_CPU: '1', PAIROFCLEATS_SCHEDULER_MAX_IO: '8', PAIROFCLEATS_SCHEDULER_MAX_MEM: '2'
} });
const clock = Date.now, originalTotal = os.totalmem, originalFree = os.freemem,
  constrained = process.constrainedMemory, available = process.availableMemory;
let runtime;
try {
  os.totalmem = () => 16 * 1024 ** 3; os.freemem = () => 12 * 1024 ** 3;
  process.constrainedMemory = () => 0; process.availableMemory = () => 12 * 1024 ** 3;
  for (const adaptive of [true, false]) {
    const config = createFastIndexingTestConfig({ quality: 'fast', threads: 1,
      indexing: { workerPool: { enabled: false }, embeddings: { enabled: false, mode: 'off' },
        scheduler: { cpuTokens: 1, ioTokens: 2, memoryTokens: 2, adaptive } } });
    await fs.writeFile(path.join(root, '.pairofcleats.json'), JSON.stringify(config));
    runtime = await createBuildRuntime({ root, argv: { mode: 'code', stage: 'stage1', threads: 1 }, rawArgv: ['--threads', '1'] });
    assert.equal(runtime.schedulerConfig.ioTokens, 2); assert.equal(runtime.schedulerConfig.maxIoTokens, 8);
    let now = clock(); Date.now = () => now;
    let release; const finish = new Promise(resolve => { release = resolve; }); const work = [];
    const signal = new AbortController().signal;
    try {
      for (let ordinal = 0; ordinal < 24; ordinal++) {
        now += 2000;
        work.push(runtime.queues.io.add(() => finish, { signal }));
        work.at(-1).catch(() => {}); await tick();
      }
      const stats = runtime.scheduler.stats();
      assert.equal(stats.tokens.io.total, adaptive ? 8 : 2, 'normal build construction honors growth/disabled adaptation under sustained demand');
      assert.equal(stats.tokens.io.used, Math.min(adaptive ? 8 : 2, runtime.queues.io.concurrency));
      if (adaptive) {
        assert.equal(stats.adaptive.fd.available, false);
        assert.equal(stats.adaptive.fd.tokenCap, null);
        assert.equal(stats.adaptive.fd.source, 'unavailable');
      }
    } finally { release(); await Promise.all(work); Date.now = clock; }
    await teardownRuntime(runtime); runtime = null;
  }
  // The internal scheduler API supports disabling its surface controller. It
  // is deliberately tested here without inventing a public configuration key.
  const scheduler = createBuildScheduler({ adaptive: true, cpuTokens: 1, ioTokens: 2, memoryTokens: 2,
    maxCpuTokens: 1, maxIoTokens: 8, maxMemoryTokens: 2, adaptiveSurfaces: { enabled: false } });
  const queues = createRuntimeQueues({ scheduler, cpuConcurrency: 1, ioConcurrency: 8,
    fileConcurrency: 1, embeddingConcurrency: 0, pendingLimits: {} }).queues;
  let now = clock(), release; const finish = new Promise(resolve => { release = resolve; }), work = [];
  Date.now = () => now;
  try {
    for (let index = 0; index < 24; index++) { now += 2000; work.push(queues.io.add(() => finish)); await tick(); }
    assert.equal(scheduler.stats().tokens.io.total, 8);
    assert.equal(scheduler.stats().adaptive.surfaceControllersEnabled, false);
  } finally { release(); await Promise.all(work); Date.now = clock; await scheduler.shutdown({ awaitRunning: true }); }
} finally {
  Date.now = clock; os.totalmem = originalTotal; os.freemem = originalFree;
  process.constrainedMemory = constrained; process.availableMemory = available;
  await teardownRuntime(runtime); await fs.rm(dir, { recursive: true, force: true });
}
console.log('Public build/env controls qualify growth and disabled adaptation; internal scheduler surface-off control remains distinct. No throughput claim.');
