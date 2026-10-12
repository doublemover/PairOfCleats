import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readFilterMatchPage, persistFilterMatches, FILTER_MATCH_ENTRY_BYTES } from '../../../src/retrieval/pipeline/filter-enumeration-cache.js';
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-filter-cache-integrity-'));
try {
  const identity = 'generation:request:time:code', ids = Uint32Array.from([1, 3, 5]);
  assert.equal(await persistFilterMatches({ cacheDir: root, identity, rowCount: 10, ids }), true);
  const request = { cacheDir: root, identity, rowCount: 10, offset: 1, limit: 1 };
  const page = await readFilterMatchPage(request); assert.deepEqual([...page.ids], [3]); assert.equal(page.total, 3);
  assert.equal(await readFilterMatchPage({ ...request, rowCount: 11 }), null);
  assert.equal(await readFilterMatchPage({ ...request, identity: 'other-generation' }), null);
  const dir = path.join(root, 'filter-enumeration-v1');
  const entry = path.join(dir, (await fs.readdir(dir)).find(file => file.endsWith('.bin')));
  const bytes = await fs.readFile(entry), size = bytes.readUInt32LE(), header = JSON.parse(bytes.subarray(4, size + 4));
  const data = JSON.parse(header.data); data.total = 2; header.data = JSON.stringify(data);
  const changed = Buffer.from(JSON.stringify(header)), length = Buffer.alloc(4); length.writeUInt32LE(changed.length);
  await fs.writeFile(entry, Buffer.concat([length, changed, bytes.subarray(size + 4)]));
  assert.equal(await readFilterMatchPage(request), null, 'total cannot change without the private authenticated header');
  assert.equal(await persistFilterMatches({ cacheDir: root, identity: 'oversize', rowCount: 10000000,
    ids: new Uint32Array(FILTER_MATCH_ENTRY_BYTES / 4 + 1) }), false);
  for (let id = 0; id < 40; id += 1) assert.equal(await persistFilterMatches({ cacheDir: root, identity: 'entry-' + id, rowCount: 10, ids }), true);
  const retained = (await fs.readdir(dir)).filter(file => file.endsWith('.bin'));
  assert.equal(retained.length, 32, 'persistent admission evicts rather than growing with requests');
  const escapedRoot = path.join(root, 'escape'), outside = path.join(root, 'outside');
  await fs.mkdir(escapedRoot); await fs.mkdir(outside);
  await fs.symlink(outside, path.join(escapedRoot, 'filter-enumeration-v1'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal(await persistFilterMatches({ cacheDir: escapedRoot, identity, rowCount: 10, ids }), false);
  assert.equal(await readFilterMatchPage({ ...request, cacheDir: escapedRoot }), null);
  assert.deepEqual(await fs.readdir(outside), [], 'a namespace symlink cannot write or evict outside the cache root');
  console.log(JSON.stringify({ contract: 'authenticated-bounded-filter-cache', retainedEntries: retained.length,
    entryIdBytes: FILTER_MATCH_ENTRY_BYTES, corruptionFallback: true, generationScope: true }));
} finally { await fs.rm(root, { recursive: true, force: true }); }
