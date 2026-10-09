#!/usr/bin/env node
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { createEg2WorkerRuntime } from '../../../src/integrations/inference-history/eg2-worker-runtime.js';

const config = {
  passagePrefix: 'title: none | text: ', queryPrefix: 'task: search result | query: ',
  profile: { dimensions: 256 }, fullProfile: { family: 'embeddinggemma2', dimensions: 768, maxLength: 8192 },
  modelsDir: process.cwd(), modelId: 'onnx-community/embeddinggemma-2-ONNX',
  localFilesOnly: true, sessionOptions: {}, documentIdentityKey: 'document', queryIdentityKey: 'query',
  representationIdentityKey: 'representation'
};
const vector = marker => { const values = new Float32Array(768); values[0] = marker; values[1] = 1; return values; };
class FakeChild extends EventEmitter {
  constructor({ stall = false, badNonce = false, noReady = false } = {}) {
    super(); Object.assign(this, { pid: 424242, exitCode: null, signalCode: null, connected: true, stall, badNonce, noReady });
    this.requests = []; this.kills = 0; this.handleCounter = 1;
  }
  send(message, callback) {
    callback?.(null);
    if (message.type === 'init') {
      this.nonce = message.nonce;
      if (!this.noReady) queueMicrotask(() => this.emit('message', { type: 'ready', nonce: this.nonce, pid: this.pid }));
      return;
    }
    if (message.type !== 'request') return;
    this.requests.push(message);
    if (this.stall) return;
    let value;
    if (message.method === 'measure') value = message.value.map(text => text.length + 2);
    else if (message.method === 'prepare') {
      value = message.value.map(text => ({ id: this.handleCounter++, tokenLength: Array.from(text).length + 2 }));
    } else if (message.method === 'prepared') value = message.value.map(id => vector(id));
    else if (message.method === 'batch') value = message.value.map((_, index) => vector(index + 1));
    else if (message.method === 'query') value = [vector(4)];
    else value = { enabled: false, sessions: [] };
    queueMicrotask(() => this.emit('message', { type: 'result', nonce: this.badNonce ? 'wrong' : this.nonce,
      id: message.id, ok: true, value, info: { device: 'cpu', sessions: ['model'] } }));
  }
  kill(signal) {
    this.kills += 1;
    this.exitCode = null; this.signalCode = signal; this.connected = false;
    queueMicrotask(() => this.emit('exit', null, signal));
    return true;
  }
}
const fake = new FakeChild();
let spawns = 0;
const runtime = createEg2WorkerRuntime(config, {
  graceMs: 10, confirmationMs: 100, spawnImpl: (_, args, options) => {
    spawns += 1;
    assert.deepEqual(args, []);
    assert.equal(options.windowsHide, true);
    assert.equal(options.serialization, 'advanced');
    assert.deepEqual(options.execArgv, ['--max-old-space-size=8192']);
    return fake;
  }
});
assert.equal(runtime.executionInfo().childPid, null, 'telemetry must not spawn/load');
const handles = await runtime.prepareBatch([{ text: 'a' }, { text: 'bbbb' }]);
assert.equal(fake.requests[0].value[0], 'title: none | text: a');
assert.equal(handles[0].tokenLength, 'title: none | text: a'.length + 2);
assert.deepEqual(await runtime.measureBatch([{ text: 'body', title: 'HTTPServer config' }]), ['title: HTTPServer config | text: body'.length + 2]);
assert.equal(fake.requests.at(-1).value[0], 'title: HTTPServer config | text: body');
await assert.rejects(() => runtime.prepareBatch(['retired string API']), /document text/);
assert.equal((await runtime.encodePrepared([handles[1], handles[0]]))[0][0], 2);
await assert.rejects(() => runtime.encodePrepared([{ tokenLength: 3 }]), /another worker/);
assert.equal((await runtime.encodeQuery('find code')).length, 256);
assert.equal(fake.requests.at(-1).value, 'task: search result | query: find code');
assert.deepEqual(await runtime.endProfiling(), { enabled: false, sessions: [] });
assert.equal(runtime.executionInfo().cpuOnly, true);
assert.equal(runtime.executionInfo().sessions[0], 'model');
await runtime.waitForIdle();
const stopped = await runtime.cancel();
assert.equal(stopped.requestAccepted, true);
assert.equal(stopped.workerStopped, true);
assert.equal(stopped.forced, true);
assert.equal(stopped.signal, 'SIGKILL');
assert.equal(fake.kills, 1);
await runtime.cancel();
assert.equal(fake.kills, 1, 'terminal runtime never kills again or uses stale PID');
await assert.rejects(() => runtime.encodeBatch([{ text: 'new' }]), /cancelled/);
assert.equal(spawns, 1, 'terminal runtime never restarts automatically');

const stalled = new FakeChild({ stall: true });
const isolated = createEg2WorkerRuntime(config, { spawnImpl: () => stalled, graceMs: 20, confirmationMs: 100 });
const controller = new AbortController();
const pending = isolated.encodeBatch([{ text: 'pending' }], { signal: controller.signal });
const rejected = assert.rejects(pending, /owner stop/);
await new Promise(resolve => setTimeout(resolve, 5));
await assert.rejects(() => isolated.encodeBatch([{ text: 'second' }]), /one request/);
const started = performance.now();
controller.abort(new Error('owner stop'));
assert.equal(isolated.executionInfo().draining, true);
assert.equal(isolated.executionInfo().exited, false, 'acceptance does not pretend native work stopped');
const receipt = await isolated.cancel();
await rejected;
assert.equal(receipt.workerStopped, true);
assert.ok(performance.now() - started < 1000);
assert.equal(stalled.kills, 1);
await isolated.waitForIdle();

const notReady = new FakeChild({ noReady: true });
const early = createEg2WorkerRuntime(config, { spawnImpl: () => notReady, graceMs: 10, readinessMs: 1000, confirmationMs: 100 });
const earlyController = new AbortController();
const earlyRejected = assert.rejects(early.encodeBatch([{ text: 'x' }], { signal: earlyController.signal }), /early stop/);
earlyController.abort(new Error('early stop'));
await earlyRejected;
assert.equal((await early.cancel()).workerStopped, true, 'cancellation is observed even while waiting for readiness');

const malformed = new FakeChild({ badNonce: true });
const broken = createEg2WorkerRuntime(config, { spawnImpl: () => malformed, graceMs: 10, confirmationMs: 100 });
await assert.rejects(() => broken.encodeBatch([{ text: 'x' }]), /protocol validation/);
assert.equal((await broken.cancel()).workerStopped, true);

const uncertainChild = new FakeChild({ stall: true });
const uncertain = createEg2WorkerRuntime(config, {
  spawnImpl: () => uncertainChild, graceMs: 5, confirmationMs: 15, terminateImpl: () => false
});
const uncertainRejected = assert.rejects(uncertain.encodeBatch([{ text: 'x' }]), /termination is unconfirmed/);
await new Promise(resolve => setTimeout(resolve, 2));
const uncertainReceipt = await uncertain.cancel();
assert.equal(uncertainReceipt.workerStopped, false, 'failed kill must remain explicitly unconfirmed');
assert.equal(uncertain.executionInfo().exited, false);
await assert.rejects(() => uncertain.dispose(), /disposal is unconfirmed/);
uncertainChild.kill('SIGKILL');
await uncertainRejected;
await uncertain.waitForIdle();

const real = createEg2WorkerRuntime(config, {
  workerPath: fileURLToPath(new URL('./eg2-worker-stalled-fixture.js', import.meta.url)),
  graceMs: 30, readinessMs: 2000, confirmationMs: 2000
});
const realRejected = assert.rejects(real.encodeBatch([{ text: 'synthetic stalled child' }]), /cancelled/);
for (let attempt = 0; attempt < 100 && !real.executionInfo().ready; attempt += 1) {
  await new Promise(resolve => setTimeout(resolve, 10));
}
assert.equal(real.executionInfo().ready, true);
const realPid = real.executionInfo().childPid;
assert.ok(Number.isSafeInteger(realPid) && realPid !== process.pid);
const realStop = await real.cancel();
assert.equal(realStop.workerStopped, true, 'owned stalled process really exited');
assert.ok(Date.parse(realStop.requestedAt)<=Date.parse(realStop.forceRequestedAt));
assert.ok(Date.parse(realStop.forceRequestedAt)<=Date.parse(realStop.exitedAt),'reported stop follows observed termination');
await realRejected;
assert.equal(real.executionInfo().exited, true);
assert.throws(() => process.kill(realPid, 0), 'owned child is absent after confirmed exit');
console.log('Isolated EG2 IPC mapping, ownership, prompt cancellation and confirmed process exit passed (no model inference).');


