import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { open } from 'lmdb';
import { Packr } from 'msgpackr';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { LMDB_ARTIFACT_KEYS, LMDB_META_KEYS } from '../../../src/storage/lmdb/schema.js';
import { META_V2_SCHEMA_VERSION } from '../../../src/index/metadata/meta-v2.js';
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-filter-native-'));
const execute = promisify(execFile), rows = 10000;
try {
  const sqlitePath = path.join(root, 'index.sqlite'), sqlite = new Database(sqlitePath);
  sqlite.exec('CREATE TABLE chunks(id INTEGER,mode TEXT,file TEXT,kind TEXT,docmeta TEXT,metaV2_json TEXT, PRIMARY KEY(mode,id))');
  const insert = sqlite.prepare('INSERT INTO chunks VALUES(?,?,?,?,?,?)');
  sqlite.transaction(() => { for (let id = 0; id < rows; id += 1) insert.run(id, 'code', 'src/' + id + '.ts', 'FunctionDeclaration', '{}',
    JSON.stringify({ schemaVersion: META_V2_SCHEMA_VERSION })); })();
  sqlite.close();
  const lmdbPath = path.join(root, 'lmdb'), lmdb = open({ path: lmdbPath, encoding: 'binary' }), packr = new Packr();
  // Match the actual LMDB producer's record codec. The module-level pack()
  // encodes maps, which the record-oriented reader intentionally retains as Maps.
  await lmdb.put(LMDB_META_KEYS.chunkCount, packr.pack(rows));
  await lmdb.put(LMDB_ARTIFACT_KEYS.chunkMeta, packr.pack(Array.from({ length: rows }, (_, id) => ({ id, file: 'src/' + id + '.ts', kind: 'FunctionDeclaration' }))));
  await lmdb.close();
  for (const [backend, location] of [['sqlite', sqlitePath], ['lmdb', lmdbPath]]) {
    const cacheDir = path.join(root, backend + '-cache'); await fs.mkdir(cacheDir);
    let cursor = null, scans = 0, loads = 0; const ids = [], costs = [];
    do {
      const result = await execute(process.execPath, ['tests/retrieval/filters/filter-only-native-page-child.js', JSON.stringify({ backend, location, cacheDir, cursor })],
        { timeout: 5000, maxBuffer: 1048576 });
      const page = JSON.parse(result.stdout), cost = page.pagination.cost.byMode.code;
      scans += cost.scannedMetadata; loads += cost.startupWork.metadataLoadedRows; costs.push(cost);
      assert.equal(cost.startupWork.tokenIndexLoaded, false); assert.equal(cost.startupWork.filterIndexBuilt, false);
      if (cursor) {
        assert.equal(cost.matchingRepresentation, 'persisted-seek');
        if (backend === 'sqlite') assert.equal(cost.startupWork.kind, 'sqlite-seek-page');
        else assert.equal(cost.startupWork.kind, 'authenticated-metadata-seek-page');
      }
      ids.push(...page.ids); cursor = page.pagination.nextCursor;
    } while (cursor);
    assert.equal(ids.length, rows, backend + ' must return every native metadata row');
    assert.deepEqual(ids, Array.from({ length: rows }, (_, id) => id));
    assert.equal(scans, rows);
    if (backend === 'sqlite') assert.ok(loads < 2 * rows, 'cold SQLite hydrates only continuation-page metadata');
    else assert.equal(loads, rows + rows - 997, 'LMDB decodes the authoritative blob only on the first page');
    console.log(JSON.stringify({ backend, qualification: 'real native handles; fresh process for every page', rows, pages: costs.length,
      predicateScans: scans, metadataLoadedRows: loads, startup: costs.map(cost => cost.startupWork), additionalMatchingCacheBytes: 64 * 1024 * 1024,
      limitation: 'first page materializes metadata; bounded continuation entries seek page rows; invalid or oversized caches fall back' }));
  }
} finally { await fs.rm(root, { recursive: true, force: true }); }
