// Source regression authored for the development batch; UNVALIDATED.
// Real disposable native file streams, injected iterator protocol timing only.
import assert from 'node:assert/strict';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { once } from 'node:events';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { downloadToBuffer, settleInstallDownload } from '../../../tools/tooling/install-shared.js';

const root = await makeTempDir('download-node-iterator-');
const streams = [];
const gates = [];
try {
  const file = path.join(root, 'body.bin');
  await fs.writeFile(file, 'data');
  const create = async iterator => {
    const body = fsSync.createReadStream(file);
    streams.push(body);
    await once(body, 'open');
    body[Symbol.asyncIterator] = () => iterator;
    return body;
  };
  const request = body => ({ url: 'https://official.example.test/node-body', label: 'inert native body',
    timeoutMs: 1000, maxBytes: 4, settlementTimeoutMs: 5,
    fetchImpl: async () => ({ ok: true, status: 200, url: 'https://official.example.test/node-body',
      headers: { get: () => null }, body }) });

  {
    let returns = 0;
    const body = await create({ next: async () => ({ done: false, value: new Uint8Array(5) }),
      return: async () => { returns++; return { done: true }; } });
    let allowClose;
    const gate = new Promise(resolve => { allowClose = resolve; gates.push(resolve); });
    const destroy = body.destroy.bind(body);
    body.destroy = error => { gate.then(() => destroy(error)); return body; };
    let pending;
    await assert.rejects(downloadToBuffer(request(body)), error => {
      pending = error;
      return error.reason === 'download_too_large' && error.cacheOwnershipPending === true;
    });
    assert.equal(returns, 1);
    assert.equal(body.closed, false);
    assert.equal(pending.downloadSession.isSettled(), false, 'iterator return done does not establish actual native close');
    allowClose();
    await settleInstallDownload(pending);
    assert.equal(body.closed, true);
    assert.equal(returns, 1, 'timeout reconciliation keeps the original owned iterator return rather than starting another');
  }

  {
    let completeReturn;
    const body = await create({ next: async () => ({ done: false, value: new Uint8Array(5) }),
      return: () => new Promise(resolve => { completeReturn = () => resolve({ done: true }); gates.push(completeReturn); }) });
    let pending;
    await assert.rejects(downloadToBuffer(request(body)), error => {
      pending = error;
      return error.reason === 'download_too_large' && error.cacheOwnershipPending === true;
    });
    if (!body.closed) await once(body, 'close');
    assert.equal(body.closed, true);
    assert.equal(pending.downloadSession.isSettled(), false, 'native close alone cannot settle the still-owned iterator teardown');
    completeReturn();
    await settleInstallDownload(pending);
    assert.equal(pending.downloadSession.isSettled(), true);
  }

  {
    let reads = 0, returns = 0;
    const body = await create({ next: async () => ++reads === 1
      ? { done: false, value: new Uint8Array([1, 2, 3, 4]) } : { done: true },
    return: async () => { returns++; return { done: true }; } });
    const closeFailure = Object.assign(new Error('inert successful EOF followed by native close failure'), { code: 'EIO', syscall: 'close' });
    body.once('close', () => body.emit('error', closeFailure));
    let pending;
    await assert.rejects(downloadToBuffer({ ...request(body), settlementTimeoutMs: 1000 }), error => {
      pending = error;
      return error === closeFailure && error.cacheOwnershipPending === true;
    });
    assert.equal(reads, 2);
    assert.equal(returns, 0, 'a consumed iterator does not need another protocol return');
    assert.equal(body.closed, true);
    assert.equal(pending.downloadSession.isSettled(), false, 'successful byte EOF cannot override an observed native close failure');
    await assert.rejects(settleInstallDownload(pending), error => error === closeFailure);
    assert.equal(pending.cacheOwnershipReleased(), false);
  }
} finally {
  for (const release of gates) release();
  for (const stream of streams) {
    if (!stream.closed) { const closed = once(stream, 'close'); stream.destroy(); await closed; }
  }
  await rmDirRecursive(root);
}
console.log('Node download iterator completion, actual native close and pending teardown remain separate owners.');
