import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { Worker } from 'node:worker_threads';

// Exercise the installed ConPTY bridge itself with real pipes. The fake native
// producer keeps writing after the terminal's output reader has disconnected.
const require = createRequire(import.meta.url);
const workerPath = path.join(path.dirname(require.resolve('node-pty/package.json')), 'lib/worker/conoutSocketWorker.js');
// Inject peer EOF precisely between a queued frame and forwarding it. Real
// sockets still generate EPIPE; only scheduling of the disposal edge is fixed.
const queuedFinSource = `
  const net = require('node:net'), { workerData } = require('node:worker_threads');
  const destinations = new WeakSet(), createServer = net.createServer, write = net.Socket.prototype.write;
  net.createServer = listener => createServer(socket => { destinations.add(socket); listener(socket); });
  let injected = false;
  net.Socket.prototype.write = function(...args) {
    if (destinations.has(this) && !injected) {
      if (workerData.unexpectedError) {
        injected = true; this.emit('error', Object.assign(new Error('explicit unexpected transport failure'), { code: 'EACCES' })); return false;
      }
      injected = true; this.end(); this.emit('end'); return this.write(...args);
    }
    return write.apply(this, args);
  };
  require(workerData.entry);
`;
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-conout-'));
const bounded = async (promise, label) => {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Conout lifecycle did not finish: ${label}`)), 3000);
  })]); } finally { clearTimeout(timer); }
};
try {
  for (const [index, mode] of ['fin-race', 'unexpected', 'disconnect', 'natural'].entries()) {
    // The already unique private directory supplies isolation. Repeating a UUID
    // in the socket filename exceeds macOS's sockaddr_un bound under its TMPDIR.
    const sourceName = process.platform === 'win32' ? `\\\\.\\pipe\\poc-conout-${randomUUID()}` : path.join(root, `p${index}`);
    if (process.platform !== 'win32') assert.ok(Buffer.byteLength(`${sourceName}-worker`) < 104, 'UNIX socket exceeds sockaddr_un capacity');
    let producer, terminal;
    const errors = [];
    const source = net.createServer(socket => { producer = socket; socket.on('error', error => errors.push(error.code)); });
    await new Promise((resolve, reject) => { source.once('error', reject); source.listen(sourceName, resolve); });
    const worker = ['fin-race', 'unexpected'].includes(mode)
      ? new Worker(queuedFinSource, { eval: true, workerData: { conoutPipeName: sourceName, entry: workerPath, unexpectedError: mode === 'unexpected' } })
      : new Worker(workerPath, { workerData: { conoutPipeName: sourceName } });
    const workerErrors = [];
    worker.on('error', error => workerErrors.push({ code: error.code, message: error.message }));
    const exited = new Promise(resolve => worker.once('exit', resolve));
    try {
      await bounded(new Promise((resolve, reject) => { worker.once('message', resolve); worker.once('error', reject); }), 'bridge ready');
      terminal = net.createConnection(`${sourceName}-worker`);
      terminal.on('error', error => errors.push(error.code));
      await bounded(new Promise((resolve, reject) => { terminal.once('connect', resolve); terminal.once('error', reject); }), 'reader connected');
      const closed = new Promise(resolve => terminal.once('close', resolve));
      if (['fin-race', 'unexpected'].includes(mode)) producer.write('queued-before-peer-FIN');
      else {
        const received = new Promise(resolve => terminal.once('data', data => resolve(data.toString())));
        producer.write('first'); assert.equal(await bounded(received, 'initial output'), 'first');
      }
      if (mode !== 'natural') {
        if (mode === 'disconnect') terminal.end();
        // Queue native output across the peer's FIN, before close/unpipe can
        // settle. This is the disposal race observed after real ConPTY runs.
        await new Promise(resolve => producer.write(Buffer.alloc(1024 * 1024, 120), resolve));
        await bounded(closed, 'reader close');
        if (mode === 'unexpected') {
          assert.equal(await bounded(exited, 'unexpected error propagation'), 1);
          assert.equal(workerErrors[0]?.code, 'EACCES', 'unexpected transport errors must remain failures');
          continue;
        }
        for (let i = 0; i < 8; i++) {
          await new Promise(resolve => producer.write(`late-${i}`, resolve));
          await new Promise(resolve => setTimeout(resolve, 5));
        }
      }
      producer.end();
      let status;
      try { status = await bounded(exited, 'natural worker disposal'); }
      catch (error) { error.message += `; workerErrors=${JSON.stringify(workerErrors)}; sourceErrors=${JSON.stringify(errors)}`; throw error; }
      assert.deepEqual(workerErrors, [], 'closing a terminal must not crash its bridge on late output');
      assert.equal(status, 0); assert.deepEqual(errors, []);
    } finally {
      terminal?.destroy(); producer?.destroy(); await worker.terminate();
      await new Promise(resolve => source.close(resolve));
    }
  }
  const missing = process.platform === 'win32' ? `\\\\.\\pipe\\poc-absent-${randomUUID()}` : path.join(root, 'absent');
  const failed = new Worker(workerPath, { workerData: { conoutPipeName: missing } });
  const error = new Promise(resolve => failed.once('error', resolve));
  const exited = new Promise(resolve => failed.once('exit', resolve));
  try {
    assert.equal((await bounded(error, 'missing producer failure')).code, 'ENOENT');
    assert.equal(await bounded(exited, 'failed worker disposal'), 1, 'real initialization failures remain failures');
  } finally { await failed.terminate(); }
} finally { await fs.rmdir(root); }
console.log('Installed ConPTY bridge drains late output, closes naturally, and preserves initialization failures.');
