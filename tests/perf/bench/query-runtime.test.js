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
assert.equal(
  adaptive.effectiveConcurrency,
  2,
  'expected giant memory artifacts to clamp mixed query workers to memory=1 and sqlite=1'
);
assert.equal(adaptive.reason, 'memory_artifact_very_large', 'expected giant artifact reason');
assert.deepEqual(
  adaptive.backendConcurrency,
  { memory: 1, sqlite: 1 },
  'expected mixed query plan to expose backend-specific worker counts'
);
assert.equal(
  adaptive.backendMaxRunsPerWorker.sqlite,
  1,
  'expected sqlite worker plan to recycle each worker after one run'
);

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

const recycleScriptPath = path.join(tempRoot, 'recycle-worker.js');
await fs.writeFile(recycleScriptPath, [
  "if (typeof process.send !== 'function') process.exit(2);",
  "process.on('message', (message) => {",
  "  if (message?.type === 'shutdown') { process.exit(0); return; }",
  "  if (message?.type !== 'run') return;",
  "  process.send({ type: 'run-start', id: Number(message.id), elapsedMs: 0 });",
  "  process.send({ type: 'run-complete', id: Number(message.id), elapsedMs: 0 });",
  "  process.send({ id: Number(message.id), ok: true, payload: { pid: process.pid } });",
  "});"
].join('\n'), 'utf8');

const recyclingPool = createSearchWorkerPool({
  size: 1,
  env: { ...process.env },
  workerScriptPath: recycleScriptPath,
  maxRunsPerProcess: 1
});
const firstRecycle = await recyclingPool.run(['--ok'], { backend: 'sqlite', query: 'select 1' });
const secondRecycle = await recyclingPool.run(['--ok'], { backend: 'sqlite', query: 'select 2' });
assert.notEqual(
  firstRecycle?.pid,
  secondRecycle?.pid,
  'expected sqlite-style worker recycling to fork a fresh child after each run'
);
await recyclingPool.close();

const nonRecyclingPool = createSearchWorkerPool({
  size: 1,
  env: { ...process.env },
  workerScriptPath: recycleScriptPath,
  maxRunsPerProcess: 0
});
const firstNonRecycling = await nonRecyclingPool.run(['--ok'], { backend: 'memory', query: 'select keepalive 1' });
const secondNonRecycling = await nonRecyclingPool.run(['--ok'], { backend: 'memory', query: 'select keepalive 2' });
assert.equal(
  firstNonRecycling?.pid,
  secondNonRecycling?.pid,
  'expected maxRunsPerProcess=0 to preserve the same worker instead of forcing recycle'
);
await nonRecyclingPool.close();

const exitingScriptPath = path.join(tempRoot, 'exit-worker.js');
await fs.writeFile(exitingScriptPath, [
  "process.on('message', (message) => {",
  "  if (message?.type === 'shutdown') { process.exit(0); return; }",
  "  if (message?.type !== 'run') return;",
  "  process.stderr.write('worker exploded\\n');",
  "  process.exit(7);",
  "});"
].join('\n'), 'utf8');

const exitPool = createSearchWorkerPool({
  size: 1,
  env: { ...process.env },
  workerScriptPath: exitingScriptPath
});
let exitError = null;
try {
  await exitPool.run(['--explode'], { backend: 'sqlite', query: 'explode query' });
} catch (error) {
  exitError = error;
}
assert.equal(exitError?.code, 'ERR_QUERY_WORKER_EXIT', 'expected early worker exit to surface deterministic code');
assert.match(exitError?.message || '', /backend=sqlite/, 'expected exit error to retain backend context');
assert.match(exitError?.message || '', /explode query/, 'expected exit error to retain query preview');
assert.match(exitError?.meta?.stderrTail || '', /worker exploded/, 'expected exit error to include stderr tail');
await exitPool.close();

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

const slowScriptPath = path.join(tempRoot, 'slow-worker.js');
await fs.writeFile(slowScriptPath, [
  "if (typeof process.send !== 'function') process.exit(2);",
  "process.on('message', (message) => {",
  "  if (message?.type === 'shutdown') { process.exit(0); return; }",
  "  if (message?.type !== 'run') return;",
  "  const id = Number(message.id);",
  "  process.send({ type: 'run-start', id, elapsedMs: 0 });",
  "  setTimeout(() => {",
  "    process.send({ type: 'run-heartbeat', id, elapsedMs: 500, rssBytes: 16 * 1024 * 1024 });",
  "  }, 500);",
  "});"
].join('\n'), 'utf8');

const closeBusyPool = createSearchWorkerPool({
  size: 1,
  env: { ...process.env },
  workerScriptPath: slowScriptPath,
  heartbeatMs: 20,
  stallWarnMs: 1000,
  stallTimeoutMs: 2000
});
const busyRun = closeBusyPool.run(['--slow'], { backend: 'sqlite', query: 'close while busy' });
const busyRunAssertion = assert.rejects(
  () => busyRun,
  (error) => error?.code === 'ERR_QUERY_WORKER_CLOSED'
);
await new Promise((resolve) => setTimeout(resolve, 40));
await closeBusyPool.close();
await busyRunAssertion;

const queuedClosePool = createSearchWorkerPool({
  size: 1,
  env: { ...process.env },
  workerScriptPath: slowScriptPath,
  heartbeatMs: 20,
  stallWarnMs: 1000,
  stallTimeoutMs: 2000
});
const queuedRunA = queuedClosePool.run(['--slow-a'], { backend: 'sqlite', query: 'queued close a' });
const queuedRunB = queuedClosePool.run(['--slow-b'], { backend: 'sqlite', query: 'queued close b' });
const queuedRunAAssertion = assert.rejects(
  () => queuedRunA,
  (error) => error?.code === 'ERR_QUERY_WORKER_CLOSED'
);
const queuedRunBAssertion = assert.rejects(
  () => queuedRunB,
  (error) => error?.code === 'ERR_QUERY_WORKER_POOL_CLOSED'
);
await new Promise((resolve) => setTimeout(resolve, 40));
await queuedClosePool.close();
await queuedRunAAssertion;
await queuedRunBAssertion;

const staleExitScriptPath = path.join(tempRoot, 'stale-exit-worker.js');
const staleExitMarkerPath = path.join(tempRoot, 'stale-exit-marker.txt');
await fs.writeFile(staleExitScriptPath, [
  "import fs from 'node:fs';",
  "const markerPath = process.env.STALE_EXIT_MARKER_PATH;",
  "const send = (payload) => { if (typeof process.send === 'function') process.send(payload); };",
  "const hasMarker = () => {",
  "  try { return fs.existsSync(markerPath); } catch { return false; }",
  "};",
  "const writeMarker = () => {",
  "  try { fs.writeFileSync(markerPath, 'spawned', 'utf8'); } catch {}",
  "};",
  "process.on('SIGTERM', () => {",
  "  setTimeout(() => process.exit(0), 120);",
  "});",
  "process.on('message', (message) => {",
  "  if (message?.type === 'shutdown') { process.exit(0); return; }",
  "  if (message?.type !== 'run') return;",
  "  const id = Number(message.id);",
  "  send({ type: 'run-start', id, elapsedMs: 0 });",
  "  if (!hasMarker()) {",
  "    writeMarker();",
  "    return;",
  "  }",
  "  setTimeout(() => {",
  "    send({ type: 'run-heartbeat', id, elapsedMs: 20, rssBytes: 16 * 1024 * 1024 });",
  "    send({ type: 'run-complete', id, elapsedMs: 20 });",
  "    send({ id, ok: true, payload: { pid: process.pid, phase: 'fresh-child' } });",
  "  }, 20);",
  "});"
].join('\n'), 'utf8');

const staleExitEvents = [];
const staleExitPool = createSearchWorkerPool({
  size: 1,
  env: { ...process.env, STALE_EXIT_MARKER_PATH: staleExitMarkerPath },
  workerScriptPath: staleExitScriptPath,
  heartbeatMs: 20,
  stallWarnMs: 40,
  stallTimeoutMs: 60,
  onEvent: (event) => staleExitEvents.push(event)
});
await assert.rejects(
  () => staleExitPool.run(['--first'], { backend: 'sqlite', query: 'first query' }),
  (error) => error?.code === 'ERR_QUERY_WORKER_STALLED'
);
const recoveredPayload = await staleExitPool.run(['--second'], { backend: 'sqlite', query: 'second query' });
assert.equal(recoveredPayload?.phase, 'fresh-child', 'expected replacement worker to complete the second request');
assert.equal(
  staleExitEvents.some((event) => event?.type === 'run-start' && event?.meta?.query === 'second query'),
  true,
  'expected the replacement worker to start the second request after the stale worker retired'
);
await staleExitPool.close();

await fs.rm(tempRoot, { recursive: true, force: true });

console.log('bench query runtime test passed');
