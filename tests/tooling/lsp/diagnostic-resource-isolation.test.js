import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { createLspClient } from '../../../src/integrations/tooling/lsp/client.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { isProcessAlive } from '../../../src/shared/locks/file-lock-owner.js';

const selected = process.env.PAIROFCLEATS_TEST_ID?.split('tooling/lsp/diagnostic-resource-isolation/')[1];
assert.ok(['reader-close-sync', 'reader-close-async', 'reader-error-sync', 'reader-error-async', 'observer-sync', 'observer-async'].includes(selected));
const asynchronous = selected.endsWith('-async');
const { dir } = await prepareIsolatedTestCacheDir(`lsp-diagnostic-resource-${selected}`);
const program = path.join(dir, 'server.mjs');
const rpc = new URL('../../../src/shared/jsonrpc.js', import.meta.url).href;
await fs.writeFile(program, `import { createFramedJsonRpcParser } from ${JSON.stringify(rpc)};
const send = message => { const body = JSON.stringify(message); process.stdout.write('Content-Length: '+Buffer.byteLength(body)+'\\r\\n\\r\\n'+body); };
const parser = createFramedJsonRpcParser({ onMessage(message) {
  if (message.method === 'test/hold') {
    process.stderr.write('original server stderr\\n');
    send({jsonrpc:'2.0',id:91,method:'test/server-request',params:null});
    return;
  }
  if (message.id !== 91) return;
  if (message.error?.code !== -32603 || message.error.message !== 'LSP request failed.') throw new Error('Original handler failure response was not preserved');
  send({jsonrpc:'2.0', method:'test/held', params:{pid:process.pid}});
}, onError(error) { throw error; } });
process.stdin.on('data', chunk => parser.push(chunk));
setInterval(() => {}, 1000);
`);
let getterReads = 0, coercions = 0, logs = 0, laterObservers = 0, failedObservers = 0;
const hostile = Object.defineProperties(Object.create(null), {
  message: { get() { getterReads++; throw new Error('message getter must not execute'); } },
  code: { get() { getterReads++; throw new Error('code getter must not execute'); } },
  [Symbol.toPrimitive]: { value() { coercions++; throw new Error('error coercion must not execute'); } }
});
const failDiagnostic = () => { if (asynchronous) return Promise.reject(hostile); throw hostile; };
let heldResolve, nativeChild, exitObserved = false, closeObserved = false, readerCloseObserved = false;
const streamEvents = [], started = performance.now();
const held = new Promise(resolve => { heldResolve = resolve; });
const events = [];
const client = createLspClient({ cmd: process.execPath, args: [program], cwd: dir,
  log() { logs++; return failDiagnostic(); },
  onLifecycleEvent(event) { events.push(event); return failDiagnostic(); },
  onStderrLine: failDiagnostic,
  onRequest: failDiagnostic,
  onNotification(message) { if (message.method === 'test/held') heldResolve(message.params.pid); return failDiagnostic(); },
  spawnProcess({ cmd, args, options }) {
    nativeChild = spawn(cmd, args, options);
    for (const event of ['end', 'close', 'error']) nativeChild.stdout.on(event, () => {
      if (event === 'close') readerCloseObserved = true;
      if (streamEvents.length < 16) streamEvents.push({ event, elapsedMs: performance.now() - started });
    });
    nativeChild.once('exit', () => { exitObserved = true; });
    nativeChild.once('close', () => { closeObserved = true; });
    return nativeChild;
  }
});
client.onResourcesSettled(() => { failedObservers++; return failDiagnostic(); });
client.onResourcesSettled(() => { laterObservers++; });
let readinessTimer;
try {
  let unexpectedSpawn = false;
  const rejectedAdmission = createLspClient({ cmd: process.execPath, beforeSpawn() { throw hostile; },
    spawnProcess() { unexpectedSpawn = true; }, log: failDiagnostic });
  assert.equal(rejectedAdmission.notify('test/rejected-admission', null), false);
  assert.equal(unexpectedSpawn, false); assert.equal(rejectedAdmission.getTerminationEvidence().settled, true);
  const pending = client.request('test/hold', null, { timeoutMs: 5000 }).then(value => ({ value }), error => ({ error }));
  const pid = await Promise.race([held, new Promise((resolve, reject) => {
    readinessTimer = setTimeout(() => reject(new Error('Original child did not observe held request.')), 3000);
  })]);
  clearTimeout(readinessTimer);
  assert.equal(pid, nativeChild.pid);
  if (selected.startsWith('reader-close')) {
    assert.equal(isProcessAlive(pid), true); assert.equal(exitObserved, false); assert.equal(closeObserved, false);
    // Node26 stdout uses dummyDestroy, keeping its child fd open after end():
    // https://github.com/nodejs/node/blob/v26.13.0/lib/internal/bootstrap/switches/is_main_thread.js#L142-L148
    // Close the actual parent-owned pipe and observe its original close event.
    const readerClosed = once(nativeChild.stdout, 'close');
    nativeChild.stdout.destroy(); await readerClosed;
    assert.equal(readerCloseObserved, true); assert.equal(nativeChild.stdout.destroyed, true);
  } else if (selected.startsWith('reader-error')) assert.doesNotThrow(() => nativeChild.stdout.emit('error', hostile));
  else if (selected.startsWith('observer')) await client.kill();
  const result = await pending;
  assert.equal(result.error?.code, 'ERR_LSP_TRANSPORT_CLOSED');
  assert.equal(client.isTransportRunning(), false);
  const evidence = await client.waitForResourceSettlement({ timeoutMs: 5000 });
  assert.equal(evidence.settled, true, JSON.stringify(evidence));
  await nextTurn(); // Let already queued diagnostic rejection observers run.
  assert.equal(exitObserved, true); assert.equal(closeObserved, true);
  assert.equal(isProcessAlive(pid), false, 'actual original process must be reaped');
  assert.ok(failedObservers > 0); assert.ok(laterObservers > 0, 'one failed observer cannot suppress independent observers');
  assert.ok(logs > 0); assert.equal(getterReads, 0); assert.equal(coercions, 0);
  assert.equal(client.getMetrics().timedOut, 0); assert.equal(client.getMetrics().failed, 1);
  assert.equal(events.filter(event => event.kind === 'start').length, 1);
  assert.ok(events.some(event => event.kind === 'exit'));
  if (selected.startsWith('reader')) assert.ok(events.some(event => event.kind === 'reap' && event.reason.startsWith('reader_')));
} catch (error) {
  console.error(JSON.stringify({ scope: 'original-native-LSP-diagnostic-failure', selected, pid: nativeChild?.pid ?? null,
    streamEvents, readerCloseObserved, exitObserved, closeObserved, termination: client.getTerminationEvidence(), metrics: client.getMetrics() }));
  throw error;
} finally {
  clearTimeout(readinessTimer);
  await client.kill();
  assert.equal((await client.waitForResourceSettlement({ timeoutMs: 5000 })).settled, true);
}
console.log(`LSP ${selected} diagnostics preserve original pending rejection, child exit/close and independent resource observers`);
