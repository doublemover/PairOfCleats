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
  const metadata = Array.from({ length: 10 }, (_, id) => ({ id, file: `src/${id}.ts`,
    docmeta: { summary: 'unicode 🙂'.repeat(1500) } }));
  assert.equal(await persistFilterMatches({ cacheDir: root, identity, rowCount: 10, ids, metadata }), true);
  const seek = await readFilterMatchPage({ ...request, rowCount: undefined, includeRows: true });
  assert.equal(seek.rowCount, 10, 'authenticated count supports a cold loader without whole-index materialization');
  assert.deepEqual(seek.rows, [metadata[3]]);
  assert.equal((await readFilterMatchPage(request)).rows, null, 'ID-only consumers do not decode metadata');
  assert.equal(await readFilterMatchPage({ ...request, offset: -1 }), null);
  const rowBytes = await fs.readFile(entry);
  rowBytes[rowBytes.length - 1] ^= 1;
  await fs.writeFile(entry, rowBytes);
  assert.equal(await readFilterMatchPage({ ...request, offset: 2, includeRows: true }), null,
    'opened metadata blocks must verify before hydration');
  const oversizeMetadata = [{ id: 0, text: 'x'.repeat(FILTER_MATCH_ENTRY_BYTES) }];
  assert.equal(await persistFilterMatches({ cacheDir: root, identity: 'large-row', rowCount: 1,
    ids: Uint32Array.of(0), metadata: oversizeMetadata }), true);
  assert.equal((await readFilterMatchPage({ cacheDir: root, identity: 'large-row', offset: 0, limit: 1, includeRows: true })).rows,
    null, 'oversized metadata retains bounded ID-only acceleration');
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
