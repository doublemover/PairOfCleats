import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-filter-cold-'));
const execute = promisify(execFile);
const page = async options => {
  const result = await execute(process.execPath, ['tests/retrieval/filters/filter-only-cold-page-child.js', JSON.stringify({ cacheDir: root, ...options })],
    { timeout: 5000, maxBuffer: 1048576 });
  return JSON.parse(result.stdout);
};
try {
  let cursor = null, scans = 0, bytes = 0;
  const ids = [];
  do {
    const result = await page({ cursor });
    assert.equal(result.pagination.total, 10000);
    const cost = result.pagination.cost.byMode.code;
    scans += cost.scannedMetadata; bytes += cost.continuationReadBytes;
    if (cursor) {
      assert.equal(cost.matchingRepresentation, 'persisted-seek');
      assert.ok(cost.continuationReadBytes < 128 * 1024 + 2 * 16384 + 4);
    }
    ids.push(...result.ids); cursor = result.pagination.nextCursor;
  } while (cursor);
  assert.deepEqual(ids, Array.from({ length: 10000 }, (_, id) => id));
  assert.equal(scans, 10000, 'predicate work is linear across fresh processes');
  const files = await fs.readdir(path.join(root, 'filter-enumeration-v1'));
  const entry = path.join(root, 'filter-enumeration-v1', files.find(file => file.endsWith('.bin')));
  const corrupt = await fs.readFile(entry); corrupt[corrupt.length - 1] ^= 1;
  await fs.writeFile(entry, corrupt);
  const last = await page({ cursor: (await page({})).pagination.nextCursor });
  // The first block remains valid. Damage to a later page must trigger a scan
  // when that opened block is reached, rather than hash every earlier page.
  let damagedCursor = last.pagination.nextCursor, fallback = false;
  while (damagedCursor) {
    const result = await page({ cursor: damagedCursor });
    fallback ||= result.pagination.cost.byMode.code.scannedMetadata > 0;
    damagedCursor = result.pagination.nextCursor;
  }
  assert.equal(fallback, true);
  assert.equal((await page({ generation: { id: 'new-generation' } })).pagination.cost.byMode.code.scannedMetadata, 10000);
  const stat = await fs.stat(entry); assert.ok(stat.size <= 16 * 1024 * 1024 + 128 * 1024 + 4);
  console.log(JSON.stringify({ contract: 'cold-process-continuation', predicateScans: scans, rows: ids.length,
    verifiedContinuationBytes: bytes, entryBytes: stat.size, metadataLoader: 'caller-supplied; CLI/native receipts are separate' }));
} finally { await fs.rm(root, { recursive: true, force: true }); }
