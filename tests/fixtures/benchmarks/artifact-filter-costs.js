import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { createFilterEnumeration, enumerateFilterMatches, buildFilterPagination } from '../../../src/retrieval/pipeline/filter-enumeration.js';
import { createSqliteHelpers } from '../../../src/retrieval/sqlite-helpers.js';
import { createLmdbHelpers } from '../../../src/retrieval/lmdb-helpers.js';
import { createIndexBackendLoader } from '../../../src/retrieval/cli/load-indexes/backend.js';
import { LMDB_ARTIFACT_KEYS, LMDB_META_KEYS } from '../../../src/storage/lmdb/schema.js';
import { META_V2_SCHEMA_VERSION } from '../../../src/index/metadata/meta-v2.js';
import { observeHeapAllocations } from '../../helpers/heap-sampling.js';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const observeIo = async operation => {
  const originalOpen = fs.open, work = { opens: 0, reads: 0, readBytes: 0, stats: 0, closes: 0,
    liveDescriptors: 0, peakLiveDescriptors: 0, byFile: {} };
  fs.open = async (target, ...args) => {
    const handle = await originalOpen.call(fs, target, ...args), label = path.basename(String(target));
    const row = work.byFile[label] ||= { opens: 0, readBytes: 0, closes: 0 };
    row.opens++; work.opens++; work.liveDescriptors++;
    work.peakLiveDescriptors = Math.max(work.peakLiveDescriptors, work.liveDescriptors);
    const read = handle.read.bind(handle), stat = handle.stat.bind(handle), close = handle.close.bind(handle);
    handle.read = async (...options) => { work.reads++; const value = await read(...options);
      work.readBytes += value.bytesRead; row.readBytes += value.bytesRead; return value; };
    handle.stat = async (...options) => { work.stats++; return stat(...options); };
    handle.close = async () => { const value = await close(); work.closes++; row.closes++; work.liveDescriptors--; return value; };
    return handle;
  };
  let result;
  try { result = await operation(); }
  finally { fs.open = originalOpen; }
  assert.equal(work.liveDescriptors, 0); assert.equal(work.opens, work.closes);
  return { result, work };
};

export const runScenario = async ({ destination }) => {
  const fixture = path.join(destination, 'filter-input'); await fs.mkdir(fixture);
  const observations = [], rows = 10000, topN = 997;
  const metadata = Array.from({ length: rows }, (_, id) => ({ id, file: `src/${id}.ts`, kind: 'FunctionDeclaration' }));
  const expected = Array.from({ length: rows }, (_, id) => id);
  const filters = { type: 'FunctionDeclaration' };
  let sqliteWriter, lmdbWriter;
  try {
    const [{ default: Database }, { open }, { Packr }] = await Promise.all([import('better-sqlite3'), import('lmdb'), import('msgpackr')]);
    const sqlitePath = path.join(fixture, 'index.sqlite'), lmdbPath = path.join(fixture, 'lmdb');
    sqliteWriter = new Database(sqlitePath);
    sqliteWriter.exec('CREATE TABLE chunks(id INTEGER,mode TEXT,file TEXT,kind TEXT,docmeta TEXT,metaV2_json TEXT, PRIMARY KEY(mode,id))');
    const insert = sqliteWriter.prepare('INSERT INTO chunks VALUES(?,?,?,?,?,?)');
    sqliteWriter.transaction(() => {
      for (const row of metadata) insert.run(row.id, 'code', row.file, row.kind, '{}', JSON.stringify({ schemaVersion: META_V2_SCHEMA_VERSION }));
    })();
    sqliteWriter.close(); sqliteWriter = null;
    lmdbWriter = open({ path: lmdbPath, encoding: 'binary' });
    const packr = new Packr();
    await lmdbWriter.put(LMDB_META_KEYS.chunkCount, packr.pack(rows));
    await lmdbWriter.put(LMDB_ARTIFACT_KEYS.chunkMeta, packr.pack(metadata));
    await lmdbWriter.close(); lmdbWriter = null;
    let invocation = 0;
    const runPages = async (backend, temperature) => {
      const cacheDir = path.join(fixture, `pages-${backend}-${temperature}-${invocation++}`); await fs.mkdir(cacheDir);
      const generation = { id: path.basename(cacheDir) }, pages = [], ids = [];
      // Reusing this exact metadata array is the real warm-cache identity.
      const warmMetadata = metadata.map(row => ({ ...row }));
      let cursor = null;
      do {
        const enumeration = createFilterEnumeration({ cacheDir, cursor, generation, filters, modes: ['code'] });
        let db, idx;
        const cpu = process.cpuUsage(), start = performance.now();
        try {
          if (backend === 'caller') {
            idx = { chunkMeta: temperature === 'warm' ? warmMetadata : metadata.map(row => ({ ...row })) };
          } else {
            db = backend === 'sqlite' ? new Database(sqlitePath) : open({ path: lmdbPath, encoding: 'binary', readOnly: true });
            const sqlite = backend === 'sqlite' ? createSqliteHelpers({ getDb: () => db, postingsConfig: {} }) : null;
            const lmdb = backend === 'lmdb' ? createLmdbHelpers({ getDb: () => db, hnswConfig: {} }) : null;
            const loader = createIndexBackendLoader({ rootDir: cacheDir, userConfig: {}, filterOnly: true,
              filterEnumeration: enumeration, filterTopN: topN, annActive: false, requiredArtifacts: new Set(), hnswConfig: {},
              loadIndexFromSqlite: sqlite?.loadIndexFromSqlite, loadIndexFromLmdb: lmdb?.loadIndexFromLmdb });
            idx = await loader.loadModeIndex({ mode: 'code', run: true, backend, dir: backend === 'sqlite' ? sqlitePath : lmdbPath });
          }
          const code = await enumerateFilterMatches({ meta: idx.chunkMeta, mode: 'code', topN, enumeration,
            match: row => row.kind === filters.type, loadCost: idx.filterLoadCost,
            preparedPage: idx.preparedFilterPage, ensureMetadata: idx.loadFilterMetadata });
          const pagination = buildFilterPagination(enumeration, { code });
          await db?.close(); db = null;
          const wallMs = performance.now() - start, used = process.cpuUsage(cpu);
          assert.equal(pagination.total, rows);
          assert.deepEqual(code.map(row => row.id), expected.slice(ids.length, ids.length + topN));
          const cost = pagination.cost.byMode.code;
          if (cursor) {
            assert.equal(cost.matchingRepresentation, temperature === 'warm' ? 'warm' : 'persisted-seek');
            if (temperature === 'warm') assert.equal(cost.continuationReadBytes, 0);
            else assert.ok(cost.continuationReadBytes < 128 * 1024 + 2 * 16384 + 4);
          }
          if (backend !== 'caller') {
            assert.equal(cost.startupWork.tokenIndexLoaded, false); assert.equal(cost.startupWork.filterIndexBuilt, false);
          }
          pages.push({ page: pages.length, returned: code.length, wallMs, cpuUserMicros: used.user,
            cpuSystemMicros: used.system, cost });
          ids.push(...code.map(row => row.id)); cursor = pagination.nextCursor;
        } finally { await db?.close(); }
      } while (cursor);
      assert.deepEqual(ids, expected);
      const scans = pages.reduce((sum, page) => sum + page.cost.scannedMetadata, 0);
      assert.equal(scans, rows, 'one full predicate scan across the full enumeration');
      const metadataLoadedRows = pages.reduce((sum, page) => sum + (page.cost.startupWork.metadataLoadedRows || 0), 0);
      if (backend === 'sqlite') assert.ok(metadataLoadedRows < rows * 2);
      if (backend === 'lmdb') assert.equal(metadataLoadedRows, rows + rows - topN);
      const persisted = [];
      for (const filename of await fs.readdir(path.join(cacheDir, 'filter-enumeration-v1'))) if (filename.endsWith('.bin')) {
        const bytes = await fs.readFile(path.join(cacheDir, 'filter-enumeration-v1', filename));
        assert.ok(bytes.length <= 16 * 1024 * 1024 + 128 * 1024 + 4);
        persisted.push({ bytes: bytes.length, sha256: sha256(bytes) });
      }
      assert.equal(persisted.length, 1);
      return { rows: ids.length, idsSha256: sha256(Buffer.from(JSON.stringify(ids))), scans, metadataLoadedRows, pages, persisted };
    };
    for (const [backend, temperature] of [['caller', 'cold'], ['caller', 'warm'], ['sqlite', 'cold'], ['lmdb', 'cold']]) {
      const clean = await runPages(backend, temperature);
      const allocation = await observeHeapAllocations({ destination, name: `filter-${backend}-${temperature}`, iterations: 1,
        operation: () => runPages(backend, temperature) });
      const { result: instrumented, work } = await observeIo(() => runPages(backend, temperature));
      assert.equal(instrumented.idsSha256, clean.idsSha256);
      observations.push({ backend, temperature, clean, allocation,
        allocationScope: 'full original page pipeline plus fixture ID/cost accounting;sampled JS allocation only',
        instrumented: { pages: instrumented.pages, work },
        scope: backend === 'caller' ? 'actual enumeration;fresh metadata per cold page;one original array for warm pages'
          : 'real native handles and original backend loaders reopened/closed every page;same process;fresh-process controls separate' });
    }
    return { issue: 1762, rows, pageLimit: topN, inputSha256: sha256(Buffer.from(JSON.stringify(metadata))), observations,
      scope: 'clean per-page CPU/wall separated from descriptor instrumentation and V8 allocation passes;native storage IO is not intercepted' };
  } finally {
    sqliteWriter?.close(); await lmdbWriter?.close();
    await fs.rm(fixture, { recursive: true, force: true });
  }
};
