#!/usr/bin/env node
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { once } from 'node:events';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { installEg2WorkerShutdownWatchdog } from '../../../src/integrations/inference-history/eg2-worker-watchdog.js';
import { createEg2WorkerRuntime } from '../../../src/integrations/inference-history/eg2-worker-runtime.js';

const config = {
  passagePrefix: 'title: none | text: ', queryPrefix: 'task: search result | query: ',
  fullProfile: { maxLength: 8192 }, profile: { dimensions: 768 },
  sessionOptions: { intraOpNumThreads: 6 }, modelFileName: null
};
let spawns = 0;
const lazy = createEg2WorkerRuntime(config, { spawnImpl: () => { spawns += 1; throw new Error('must not spawn'); } });
const info = lazy.executionInfo();
assert.equal(info.loaded, false);
assert.equal(info.loading, false);
assert.deepEqual(info.sessions, []);
assert.deepEqual(info.requestedSessionOptions, { intraOpNumThreads: 6 });
assert.equal(info.effectiveNativeThreads, null);
assert.equal(info.effectiveGraphExecutionMode, null);
assert.equal(spawns, 0);
assert.equal((await lazy.dispose()).workerStopped, true);
const processObject = new EventEmitter();
let stopCalls = 0, exitCalls = 0;
processObject.exit = code => { assert.equal(code, 23); exitCalls += 1; };
const mock = installEg2WorkerShutdownWatchdog({ processObject, graceMs: 5, onStop: () => { stopCalls += 1; } });
processObject.emit('SIGINT');
processObject.emit('SIGTERM');
processObject.emit('disconnect');
assert.equal(stopCalls, 1);
await new Promise(resolve => setTimeout(resolve, 10));
assert.equal(exitCalls, 1);
mock.clear();

for (const [exitCode, mode, forced] of [[23, 'self-watchdog', true], [0, 'cooperative', false]]) {
  const child = Object.assign(new EventEmitter(), { pid: 123456, connected: true, exitCode: null, signalCode: null });
  child.send = (message, callback) => {
    callback?.(null);
    if (message.type === 'init') queueMicrotask(() => child.emit('message', { type: 'ready', nonce: message.nonce, pid: child.pid }));
    if (message.type === 'cancel') queueMicrotask(() => {
      child.exitCode = exitCode;
      child.emit('exit', exitCode, null);
    });
  };
  child.kill = () => { throw new Error('Cooperative/self-watchdog exit must not need parent kill.'); };
  const runtime = createEg2WorkerRuntime(config, { spawnImpl: () => child, graceMs: 50 });
  const rejected = assert.rejects(runtime.encodeBatch([{ text: 'x' }]), /cancelled/);
  await new Promise(resolve => setTimeout(resolve, 1));
  const receipt = await runtime.cancel();
  await rejected;
  assert.equal(receipt.workerStopped, true);
  assert.equal(receipt.terminationMode, mode);
  assert.equal(receipt.forced, forced);
  assert.equal(receipt.exitCode, exitCode);
}

const child = fork(fileURLToPath(new URL('./eg2-worker-disconnect-fixture.js', import.meta.url)), [], {
  execPath: process.execPath, execArgv: ['--max-old-space-size=128'], windowsHide: true,
  stdio: ['ignore', 'ignore', 'ignore', 'ipc'], serialization: 'advanced'
});
let exited = false;
child.once('exit', () => { exited = true; });
const cleanup = setTimeout(() => { if (!exited) child.kill('SIGKILL'); }, 3000);
try {
  const readiness = once(child, 'message');
  child.send({ type: 'init', nonce: 'a'.repeat(64) });
  const [message] = await readiness;
  assert.equal(message.pid, child.pid);
  const stopped = once(child, 'exit');
  const started = performance.now();
  child.disconnect(); // parent-side process remains alive, but its IPC is lost.
  const [code, signal] = await stopped;
  assert.equal(code, 23, 'watchdog exit must be distinguishable from cooperative disposal');
  assert.equal(signal, null);
  assert.ok(performance.now() - started < 2500, 'self-exit is bounded around documented one-second grace');
} finally {
  clearTimeout(cleanup);
  if (!exited) child.kill('SIGKILL');
}
console.log('EG2 child IPC-loss watchdog, signal admission and pre-load metadata passed (no model inference).');

