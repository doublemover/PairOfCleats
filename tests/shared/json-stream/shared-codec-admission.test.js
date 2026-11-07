#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createJsonlCompressionPool } from '../../../src/shared/json-stream/jsonl-compression-pool.js';
import { withJsonlCompressionScope, borrowJsonlCompressionPool } from '../../../src/shared/json-stream/jsonl-compression-scope.js';
import { writeJsonLinesFile } from '../../../src/shared/json-stream/jsonl-write.js';
import { readJsonLinesArray } from '../../../src/shared/artifact-io/json.js';
import { applyTestEnv } from '../../helpers/test-env.js';
applyTestEnv({ testing: '1' });
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-shared-codec-'));
try {
  const pool = createJsonlCompressionPool({ compression: null, workerCount: 1 });
  const first = await pool.acquireBlock(4 * 1024 * 1024);
  let admitted = false; const second = pool.acquireBlock(4 * 1024 * 1024).then(lease => { admitted = true; return lease; });
  await Promise.resolve(); assert.equal(admitted, false);
  assert.equal(pool.stats().workersStarted, 0, 'reservation alone starts no codec worker');
  first.release(); const next = await second; next.release();
  assert.ok(pool.stats().highWaterBytes <= pool.stats().maxReservedBytes);
  const held = await pool.acquireBlock(4 * 1024 * 1024), controller = new AbortController();
  const aborted = pool.acquireBlock(4 * 1024 * 1024, controller.signal); controller.abort();
  await assert.rejects(aborted, { code: 'ABORT_ERR' }); held.release(); await pool.close();
  for (const cpuBudget of [1, 2]) await withJsonlCompressionScope({ cpuBudget }, async () => {
    const borrowed = borrowJsonlCompressionPool({ compression: 'zstd' });
    assert.equal(borrowed.stats().workersStarted, 0);
    const values = [{ text: 'λ'.repeat(3000000) }, { end: true }];
    const files = [path.join(root, `a-${cpuBudget}.jsonl.zst`), path.join(root, `b-${cpuBudget}.jsonl.zst`)];
    await Promise.all(files.map(file => writeJsonLinesFile(file, values, { compression: 'zstd' })));
    for (const file of files) assert.deepEqual(await readJsonLinesArray(file), values);
    const stats = borrowed.stats();
    assert.ok(stats.workersStarted <= cpuBudget); assert.ok(stats.highWaterBytes <= stats.maxReservedBytes);
    assert.equal(stats.reservedBytes, 0, 'ordered consumers release all codec reservations');
  });
} finally { await fs.rm(root, { recursive: true, force: true }); }
