#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { ensureTestingEnv } from '../../helpers/test-env.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';
import {
  createSearchWorkerPool,
  resolveAdaptiveQueryWorkerCount
} from './query-runtime.js';

ensureTestingEnv(process.env);

const GiB = 1024 * 1024 * 1024;
const MiB = 1024 * 1024;
const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `bench-query-runtime-${process.pid}-${Date.now()}`);
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const adaptive = await resolveAdaptiveQueryWorkerCount({
  requestedConcurrency: 4,
  backends: ['memory', 'sqlite'],
  totalSystemMemoryBytes: 64 * GiB,
  codeArtifactBytes: 3 * GiB,
  proseArtifactBytes: 128 * MiB,
  sqliteCodeBytes: 256 * MiB,
  sqliteProseBytes: 128 * MiB
});
assert.equal(adaptive.effectiveConcurrency, 1, 'expected giant memory artifacts to clamp query workers to 1');
assert.equal(adaptive.reason, 'memory_artifact_very_large', 'expected giant artifact reason');

const workerScriptPath = path.join(tempRoot, 'worker.js');
await fs.writeFile(workerScriptPath, [
  "const send = (payload) => { if (typeof process.send === 'function') process.send(payload); };",
  "let heartbeat = null;",
  "const clearHeartbeat = () => { if (heartbeat) clearInterval(heartbeat); heartbeat = null; };",
  "process.on('message', (message) => {",
  "  if (message?.type === 'shutdown') { clearHeartbeat(); process.exit(0); return; }",
  "  if (message?.type !== 'run') return;",
  "  const id = Number(message.id);",
  "  const mode = Array.isArray(message.args) ? String(message.args[0] || '') : '';",
  "  send({ type: 'run-start', id, elapsedMs: 0 });",
  "  if (mode === '--stall') return;",
  "  const startedAt = Date.now();",
  "  heartbeat = setInterval(() => {",
  "    send({ type: 'run-heartbeat', id, elapsedMs: Date.now() - startedAt, rssBytes: 32 * 1024 * 1024 });",
  "  }, 20);",
  "  heartbeat.unref?.();",
  "  setTimeout(() => {",
  "    clearHeartbeat();",
  "    send({ type: 'run-complete', id, elapsedMs: Date.now() - startedAt });",
  "    send({ id, ok: true, payload: { stats: { elapsedMs: 42, memory: { rss: 32 * 1024 * 1024 } }, code: [], prose: [] } });",
  "  }, 90);",
  "});"
].join('\n'), 'utf8');

const successEvents = [];
const successPool = createSearchWorkerPool({
  size: 1,
  env: { ...process.env },
  workerScriptPath,
  heartbeatMs: 20,
  stallWarnMs: 80,
  stallTimeoutMs: 200,
  onEvent: (event) => successEvents.push(event)
});
const successPayload = await successPool.run(['--ok'], { backend: 'memory', query: 'select 1' });
assert.equal(Number(successPayload?.stats?.elapsedMs), 42, 'expected worker payload to resolve');
assert.equal(
  successEvents.some((event) => event?.type === 'run-start'),
  true,
  'expected run-start event'
);
assert.equal(
  successEvents.some((event) => event?.type === 'run-heartbeat'),
  true,
  'expected run-heartbeat event'
);
assert.equal(
  successEvents.some((event) => event?.type === 'run-complete'),
  true,
  'expected run-complete event'
);
await successPool.close();

const stalledEvents = [];
const stalledPool = createSearchWorkerPool({
  size: 1,
  env: { ...process.env },
  workerScriptPath,
  heartbeatMs: 20,
  stallWarnMs: 40,
  stallTimeoutMs: 80,
  onEvent: (event) => stalledEvents.push(event)
});
await assert.rejects(
  () => stalledPool.run(['--stall'], { backend: 'sqlite', query: 'select stalled' }),
  (error) => error?.code === 'ERR_QUERY_WORKER_STALLED'
);
assert.equal(
  stalledEvents.some((event) => event?.type === 'stall-warning'),
  true,
  'expected stall warning event'
);
assert.equal(
  stalledEvents.some((event) => event?.type === 'stalled'),
  true,
  'expected stalled event'
);
await stalledPool.close();

await fs.rm(tempRoot, { recursive: true, force: true });

console.log('bench query runtime test passed');
