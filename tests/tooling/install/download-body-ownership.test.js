#!/usr/bin/env node
// Source regression authored for the development batch; UNVALIDATED.
import assert from 'node:assert/strict';
import { downloadToBuffer } from '../../../tools/tooling/install-shared.js';

const url = 'https://official.example.test/inert.zip';
const request = { url, label: 'inert fixture', timeoutMs: 1000, maxBytes: 4 };
const response = body => ({ ok: true, url, status: 200, headers: { get: () => null }, body });

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
  const source = response({ getReader: () => ({
    read: () => { controller.abort(primary); return new Promise(() => {}); },
    cancel: async () => { cancelled++; throw cleanup; },
    releaseLock: () => { released++; }
  }) });
  await assert.rejects(downloadToBuffer({ ...request, signal: controller.signal, fetchImpl: async () => source }), error => {
    assert.equal(error, primary, 'caller cancellation remains the primary failure');
    assert.equal(error.downloadCleanupError, cleanup);
    return true;
  });
  assert.equal(cancelled, 1);
  assert.equal(released, 1, 'failed cancellation still releases the reader lock');
}

{
  const cleanup = new Error('fixture body cancellation failed');
  const source = response({ cancel: async () => { throw cleanup; } });
  source.headers.get = () => '5';
  await assert.rejects(downloadToBuffer({ ...request, fetchImpl: async () => source }), error => {
    assert.equal(error.reason, 'download_too_large');
    assert.equal(error.downloadCleanupError, cleanup);
    return true;
  });
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

console.log('Download byte admission, body ownership and cancellation regressions complete.');
