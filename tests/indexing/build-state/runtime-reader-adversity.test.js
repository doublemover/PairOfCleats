#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readRuntimeReceipt, listRuntimeReceipts } from '../../../src/shared/runtime-envelope/read-receipt.js';
import { boundRuntimeAttempt } from '../../../src/shared/runtime-envelope/receipt.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-receipt-reader-'));
const target = path.join(root, 'build_state.json');
const write = (value) => fs.writeFile(target, JSON.stringify(value));
const valid = { attemptId: 'attempt', lifecycle: 'running', updatedAt: '2000-01-01T00:00:00Z', extraFutureField: { safe: true } };
try {
  await write({ runtime: { schemaVersion: 2, attempts: [] } });
  assert.equal((await readRuntimeReceipt({ buildRoot: root })).evidence, 'unsupported-runtime-receipt');
  await write({ runtime: { schemaVersion: 1, attempts: [valid] } });
  const before = await fs.stat(target);
  const future = await readRuntimeReceipt({ buildRoot: root });
  assert.equal(future.attempts[0].extraFutureField.safe, true);
  assert.equal(future.attempts[0].freshness, 'stale-or-unknown');
  assert.equal((await fs.stat(target)).mtimeMs, before.mtimeMs);
  for (const value of [null, 7, { runtime: { schemaVersion: 1, attempts: [null] } },
    { runtime: { schemaVersion: 1, attempts: ['invalid'] } }]) {
    await write(value);
    const report = await readRuntimeReceipt({ buildRoot: root, redactPaths: true });
    assert.ok(report.errorCode);
    assert.equal(JSON.stringify(report).includes(root), false, 'corrupt evidence paths must still honor redaction');
  }
  await fs.writeFile(target, '{');
  assert.equal((await readRuntimeReceipt({ buildRoot: root })).errorCode, 'ERR_RUNTIME_RECEIPT_JSON');
  await fs.writeFile(target, ' '.repeat(8 * 1024 * 1024 + 1));
  assert.equal((await readRuntimeReceipt({ buildRoot: root })).errorCode, 'ERR_RUNTIME_RECEIPT_SIZE');
  const originalOpen = fs.open;
  let closed = false;
  fs.open = async (...args) => {
    if (args[0] !== target) return originalOpen(...args);
    return { stat: async () => ({ isFile: () => true, size: 2 }),
      read: async (buffer) => { buffer.write('{}x'); return { bytesRead: 3 }; },
      close: async () => { closed = true; } };
  };
  try {
    assert.equal((await readRuntimeReceipt({ buildRoot: root })).errorCode, 'ERR_RUNTIME_RECEIPT_CHANGED');
    assert.equal(closed, true);
  } finally { fs.open = originalOpen; }
  const cache = path.join(root, 'cache');
  const publishedRoots = [path.join(root, 'published-code'), path.join(root, 'published-prose')];
  for (const dir of [...publishedRoots, ...Array.from({ length: 40 }, (_, i) => path.join(cache, 'builds', `candidate-${i}`))]) {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'build_state.json'), JSON.stringify({ runtime: { schemaVersion: 1, attempts: [] } }));
  }
  const listed = await listRuntimeReceipts({ repoCacheRoot: cache, publishedRoots });
  assert.equal(listed.truncated, true);
  assert.equal(listed.receipts.length, 32);
  assert.deepEqual(listed.receipts.slice(0, 2).map((r) => r.selection), ['published-mode-root', 'published-mode-root']);
  assert.ok(listed.receipts.slice(2).every((r) => r.selection === 'unpublished-candidate'));
  assert.throws(() => boundRuntimeAttempt(Object.fromEntries(
    Array.from({ length: 64 }, (_, i) => [`field${i}`, 'x'.repeat(2048)])
  )), { code: 'ERR_RUNTIME_RECEIPT_SIZE' });
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('runtime reader adversity and bounds test passed');
