import crypto from 'node:crypto';
import os from 'node:os';
import v8 from 'node:v8';
import { isMainThread, threadId, resourceLimits } from 'node:worker_threads';
import { resolveNodeHeapSource, sanitizeNodeStartupOptions } from '../workers/node-argv.js';

const processInstanceId = crypto.randomUUID();
const startedAt = new Date(Date.now() - (process.uptime() * 1000)).toISOString();
// Capture once before runtime construction can modify the environment. This is
// an input observation, not a claim to recover the operating system's launch.
const startupInputs = {
  execArgv: [...process.execArgv],
  nodeOptions: process.env.NODE_OPTIONS || '',
  uvThreadpoolSize: process.env.UV_THREADPOOL_SIZE || null
};

export const getNodeStartupInputs = () => ({ ...startupInputs, execArgv: [...startupInputs.execArgv] });

export const observeRuntimeProcess = () => ({
  observedAt: new Date().toISOString(),
  observationMethod: 'node-process-and-v8-apis',
  processInstanceId,
  startedAt,
  pid: process.pid,
  ppid: process.ppid,
  execPath: process.execPath,
  nodeVersion: process.version,
  v8Version: process.versions.v8,
  platform: process.platform,
  arch: process.arch,
  threadId,
  isMainThread,
  host: {
    logicalCpuCount: os.cpus().length,
    availableParallelism: os.availableParallelism(),
    totalMemoryBytes: os.totalmem()
  },
  heapSizeLimitBytes: v8.getHeapStatistics().heap_size_limit,
  heapObservationMethod: 'v8.getHeapStatistics().heap_size_limit',
  // libuv does not expose an API that acknowledges its initialized pool size.
  uvThreadpoolSize: null,
  uvObservationMethod: 'unavailable',
  startupInputs: {
    ...sanitizeNodeStartupOptions(startupInputs),
    maxOldSpaceMb: resolveNodeHeapSource(startupInputs),
    uvThreadpoolSize: Number(startupInputs.uvThreadpoolSize) > 0 ? Number(startupInputs.uvThreadpoolSize) : null,
    observationMethod: 'module-initialization-input-snapshot'
  },
  resourceLimits: isMainThread ? null : { ...resourceLimits }
});
