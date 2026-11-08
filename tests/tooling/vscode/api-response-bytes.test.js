import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { requestApiJson, DEFAULT_MAX_BUFFER_BYTES } = require('../../../extensions/vscode/runtime.js');
const originalFetch = globalThis.fetch;
const endpoint = 'http://127.0.0.1:4311';

const response = (pieces, { status = 200, headers = {}, onRead = null } = {}) => {
  const work = { reads: 0, cancelled: 0, released: 0 };
  let cursor = 0;
  const reader = {
    async read() {
      work.reads++;
      onRead?.(work.reads);
      return cursor < pieces.length ? { done: false, value: Buffer.from(pieces[cursor++]) } : { done: true };
    },
    async cancel() { work.cancelled++; },
    releaseLock() { work.released++; }
  };
  return { work, payload: { ok: status >= 200 && status < 300, status, headers: new Headers(headers),
    body: { getReader: () => reader, cancel: reader.cancel },
    text() { throw new Error('Unbounded response.text() is forbidden.'); } } };
};

try {
  const bytes = Buffer.from(JSON.stringify({ value: '🙂é' }));
  const exact = response(Array.from(bytes, byte => Buffer.from([byte])));
  globalThis.fetch = async () => exact.payload;
  const accepted = await requestApiJson(endpoint, '/search', { maxResponseBytes: bytes.length });
  assert.deepEqual(accepted, { ok: true, payload: { value: '🙂é' } });
  assert.equal(exact.work.cancelled, 0);
  assert.equal(exact.work.released, 1);
  for (const status of [200, 401, 403, 500]) {
    for (const headers of [{}, { 'content-length': '1' }, { 'content-length': String(bytes.length) }]) {
      const overflow = response([bytes, Buffer.from(' '), Buffer.from('must not read')], { status, headers });
      globalThis.fetch = async () => overflow.payload;
      const refused = await requestApiJson(endpoint, '/search', { maxResponseBytes: bytes.length });
      assert.equal(refused.kind, 'api-response-too-large');
      assert.equal(overflow.work.reads, 2, 'stop at the first excess byte even with an incorrect header');
      assert.equal(overflow.work.cancelled, 1);
      assert.equal(overflow.work.released, 1);
      assert.ok(Buffer.byteLength(refused.detail || '') <= 4098, 'UTF-8 replacement remains bounded');
      assert.equal(refused.payload, undefined);
    }
  }
  const header = response([bytes], { headers: { 'content-length': String(bytes.length + 1) } });
  globalThis.fetch = async () => header.payload;
  assert.equal((await requestApiJson(endpoint, '/search', { maxResponseBytes: bytes.length })).kind, 'api-response-too-large');
  assert.equal(header.work.reads, 0);
  assert.equal(header.work.cancelled, 1);

  // Fetch decodes content encoding before the reader; wire size is not its decoded-byte admission proof.
  const compressed = response([bytes], { headers: { 'content-length': '9999', 'content-encoding': 'gzip' } });
  globalThis.fetch = async () => compressed.payload;
  assert.deepEqual((await requestApiJson(endpoint, '/search', { maxResponseBytes: bytes.length })).payload, { value: '🙂é' });

  const controller = new AbortController();
  const cancelled = response([Buffer.from('{'), bytes], { onRead: count => { if (count === 1) controller.abort(); } });
  globalThis.fetch = async () => cancelled.payload;
  assert.equal((await requestApiJson(endpoint, '/search', { signal: controller.signal })).kind, 'cancelled');
  assert.equal(cancelled.work.reads, 1);
  assert.equal(cancelled.work.cancelled, 1);
  assert.equal(cancelled.work.released, 1);

  globalThis.fetch = async () => new Response('\ufeff{"ok":true}');
  assert.deepEqual((await requestApiJson(endpoint, '/health')).payload, { ok: true });
  globalThis.fetch = async () => new Response('not-json');
  assert.equal((await requestApiJson(endpoint, '/health')).kind, 'api-invalid-json');
  globalThis.fetch = async () => new Response(JSON.stringify({ message: 'x'.repeat(8192) }), { status: 403 });
  const denied = await requestApiJson(endpoint, '/health');
  assert.equal(denied.kind, 'api-forbidden');
  assert.equal(denied.detail.length, 4096);
  assert.equal(DEFAULT_MAX_BUFFER_BYTES, 20 * 1024 * 1024, 'HTTP and CLI default byte limits agree');
} finally {
  globalThis.fetch = originalFetch;
}
console.log('Editor HTTP admission bounds decoded bytes and owns overflow/cancellation closure.');
