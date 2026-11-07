#!/usr/bin/env node
// Source regression authored for the development batch; UNVALIDATED.
import assert from 'node:assert/strict';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { once } from 'node:events';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { downloadToBuffer, settleInstallDownload } from '../../../tools/tooling/install-shared.js';

const url = 'https://official.example.test/inert.zip';
const request = { url, label: 'inert fixture', timeoutMs: 1000, maxBytes: 4 };
const response = body => ({ ok: true, url, status: 200, headers: { get: () => null }, body });

{
  const controller = new AbortController();
  const reason = new Error('inert pre-cancelled download');
  controller.abort(reason);
  let requests = 0;
  await assert.rejects(downloadToBuffer({ ...request, signal: controller.signal,
    fetchImpl: async () => { requests++; }
  }), error => error === reason);
  assert.equal(requests, 0);
}

{
  let cancelled = 0;
  let reads = 0;
  const source = response({ cancel: async () => { cancelled++; }, getReader: () => { reads++; throw new Error('must not start'); } });
  source.headers.get = () => '5';
  await assert.rejects(downloadToBuffer({ ...request, fetchImpl: async () => source }), { reason: 'download_too_large' });
  assert.equal(cancelled, 1, 'header admission failure closes the actual unlocked response body');
  assert.equal(reads, 0);
}

{
  let returned = 0;
  let nextCalls = 0;
  const source = response({ [Symbol.asyncIterator]: () => ({
    next: async () => { nextCalls++; return { done: false, value: new Uint8Array(5) }; },
    return: async () => { returned++; return { done: true }; }
  }) });
  await assert.rejects(downloadToBuffer({ ...request, fetchImpl: async () => source }), { reason: 'download_too_large' });
  assert.equal(nextCalls, 1);
  assert.equal(returned, 1, 'unknown-length overflow returns the owning iterator');
}

{
  let allocations = 0;
  let cancelled = 0;
  const source = { ...response({ cancel: async () => { cancelled++; } }),
    arrayBuffer: async () => { allocations++; return new ArrayBuffer(64); } };
  await assert.rejects(downloadToBuffer({ ...request, fetchImpl: async () => source }), { reason: 'download_stream_unavailable' });
  assert.equal(allocations, 0, 'a byte bound never allocates an unchecked arrayBuffer fallback');
  assert.equal(cancelled, 1);
}

{
  const controller = new AbortController();
  const primary = new Error('fixture user cancellation');
  const cleanup = new Error('fixture cancellation cleanup failure');
  let cancelled = 0;
  let released = 0;
  let allowClose = false;
  let finishRead;
  let pending;
  const source = response({ getReader: () => ({
    read: () => { controller.abort(primary); return new Promise(resolve => { finishRead = resolve; }); },
    cancel: async () => { cancelled++; if (!allowClose) throw cleanup; finishRead({ done: true }); },
    releaseLock: () => { released++; }
  }) });
  await assert.rejects(downloadToBuffer({ ...request, signal: controller.signal, fetchImpl: async () => source }), error => {
    assert.equal(error, primary, 'caller cancellation remains the primary failure');
    assert.equal(error.downloadCleanupError, cleanup);
    assert.equal(error.cacheOwnershipPending, true);
    assert.equal(error.retryable, false);
    pending = error;
    return true;
  });
  assert.equal(cancelled, 1);
  assert.equal(released, 0, 'failed cancellation retains the actual locked reader for reconciliation');
  assert.equal(pending.cacheOwnershipReleased(), false);
  allowClose = true;
  const settled = await settleInstallDownload(pending);
  assert.equal(settled.resourceId, pending.downloadSession.resourceId);
  assert.equal(settled.pending, false);
  assert.equal(released, 1);
  assert.equal(pending.cacheOwnershipReleased(), true);
}

{
  const cleanup = new Error('fixture body cancellation failed');
  let allowClose = false;
  let pending;
  const source = response({ cancel: async () => { if (!allowClose) throw cleanup; } });
  source.headers.get = () => '5';
  await assert.rejects(downloadToBuffer({ ...request, fetchImpl: async () => source }), error => {
    assert.equal(error.reason, 'download_too_large');
    assert.equal(error.downloadCleanupError, cleanup);
    assert.equal(error.cacheOwnershipPending, true);
    pending = error;
    return true;
  });
  allowClose = true;
  await settleInstallDownload(pending);
}

{
  let finishClose;
  let pending;
  const source = response({ cancel: () => new Promise(resolve => { finishClose = resolve; }) });
  source.headers.get = () => '5';
  await assert.rejects(downloadToBuffer({ ...request, settlementTimeoutMs: 5, fetchImpl: async () => source }), error => {
    pending = error;
    return error.reason === 'download_too_large' && error.cacheOwnershipPending === true;
  });
  assert.equal(pending.downloadSession.isSettled(), false);
  finishClose();
  await settleInstallDownload(pending);
  assert.equal(pending.downloadSession.isSettled(), true);
}

{
  let allowRelease = false, reads = 0, cancellations = 0, pending;
  const locked = new Error('inert reader lock release is blocked');
  const source = response({ getReader: () => ({
    read: async () => ++reads === 1 ? { done: false, value: new Uint8Array([1]) } : { done: true },
    cancel: async () => { cancellations++; },
    releaseLock: () => { if (!allowRelease) throw locked; }
  }) });
  await assert.rejects(downloadToBuffer({ ...request, fetchImpl: async () => source }), error => {
    pending = error;
    return error === locked && error.cacheOwnershipPending === true;
  });
  assert.equal(cancellations, 0, 'EOF ownership needs reader-lock settlement, not a second transport cancellation');
  allowRelease = true;
  await settleInstallDownload(pending);
}

{
  const controller = new AbortController();
  const primary = Object.freeze(new Error('fixture frozen cancellation'));
  let allowClose = false, finishRead, pending;
  const source = response({ getReader: () => ({
    read: () => { controller.abort(primary); return new Promise(resolve => { finishRead = resolve; }); },
    cancel: async () => { if (!allowClose) throw new Error('inert blocked teardown'); finishRead({ done: true }); },
    releaseLock: () => {}
  }) });
  await assert.rejects(downloadToBuffer({ ...request, signal: controller.signal, fetchImpl: async () => source }), error => {
    pending = error;
    return error instanceof AggregateError && error.cause === primary && error.errors[0] === primary && error.cacheOwnershipPending === true;
  });
  allowClose = true;
  await settleInstallDownload(pending);
}

{
  let returned = 0;
  const source = { ...response({ [Symbol.asyncIterator]: () => ({
    next: async () => ({ done: false, value: new Uint8Array(5) }),
    return: async () => { returned++; return { done: true }; }
  }) }), ok: false, status: 503, statusText: 'Unavailable' };
  await assert.rejects(downloadToBuffer({ ...request, drainErrorBody: true, fetchImpl: async () => source }), { reason: 'download_http_error', statusCode: 503 });
  assert.equal(returned, 1, 'bounded failed-response draining still closes an oversized body');
}

{
  let released = 0;
  let cancelled = 0;
  let reads = 0;
  const source = response({ getReader: () => ({
    read: async () => ++reads === 1 ? { done: false, value: new Uint8Array([1, 2, 3, 4]) } : { done: true },
    cancel: async () => { cancelled++; }, releaseLock: () => { released++; }
  }) });
  const downloaded = await downloadToBuffer({ ...request, fetchImpl: async () => source });
  assert.deepEqual(downloaded.body, Buffer.from([1, 2, 3, 4]));
  assert.equal(released, 1);
  assert.equal(cancelled, 0, 'complete bounded response releases its lock without cancelling consumed data');
}

{
  const root = await makeTempDir('download-native-body-');
  let allowClose;
  let downloading;
  try {
    const file = path.join(root, 'body.bin');
    await fs.writeFile(file, 'inert response bytes');
    const body = fsSync.createReadStream(file);
    await once(body, 'open');
    const closeGate = new Promise(resolve => { allowClose = resolve; });
    const destroy = body.destroy.bind(body);
    body.destroy = error => { closeGate.then(() => destroy(error)); return body; };
    const source = response(body);
    source.headers.get = () => '5';
    let terminal = false;
    downloading = downloadToBuffer({ ...request, fetchImpl: async () => source });
    downloading.catch(() => { terminal = true; });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(terminal, false, 'a Node destroy request is not actual response/native stream closure');
    assert.equal(body.closed, false);
    allowClose();
    await assert.rejects(downloading, { reason: 'download_too_large' });
    assert.equal(body.closed, true);
  } finally { allowClose?.(); if (downloading) await downloading.catch(() => {}); await rmDirRecursive(root); }
}

console.log('Download byte admission, body ownership and cancellation regressions complete.');
