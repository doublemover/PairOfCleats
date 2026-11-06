import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createArtifactOperationReader } from '../../../src/semantic/operation-reader.js';
import { compareOperationIndexRows } from '../../../src/semantic/operation-index.js';
import { sourceOrderEntry, SEMANTIC_OPERATION_INDEX_VERSION, SOURCE_ORDER_META_KEY, SOURCE_ORDER_VERSION,
  decodeSourceOrderPath } from '../../../src/semantic/source-order.js';
import { createSqliteSourceOrderReader } from '../../../src/semantic/sqlite-source-order.js';
import { CREATE_SEMANTIC_TABLES_SQL } from '../../../src/storage/sqlite/semantic/schema.js';
import { createRecoveryFixture, semanticNode } from '../../helpers/semantic-recovery.js';
import { operationIndexEntries } from '../../../src/semantic/operation-index.js';
import { writeSemanticQueryIndex } from '../../../src/index/build/artifacts/writers/semantic/query-index.js';
import { assertSemanticOperationIndex } from '../../../src/contracts/validators/semantic-operation-index.js';
import { ingestSemanticPartition } from '../../../src/storage/sqlite/semantic/ingest.js';
import { applyCachedSemanticPlan } from '../../../src/storage/sqlite/semantic/from-cache.js';

const mode = process.env.PAIROFCLEATS_TEST_ID?.split('storage/semantic/source-order-index/')[1];
assert.ok(['prefix-and-unicode', 'keyset-and-order', 'bounds-and-stale', 'physical-projection'].includes(mode));
const partitionId = 'sy1:' + 'a'.repeat(64), canonicalHash = 'b'.repeat(64);
const generation = { baseBuildId: 'source-order-fixture', semanticRevision: 0 };
const paths = ['src/http', 'src/http.js', 'src/http/a.js', 'src/http/nested/x.js', 'src/httpology/x.js',
  'src/http/😀.js', 'src/http/\ue000.js', 'other.js'];
const rows = [];
for (const [pathIndex, sourcePath] of paths.entries()) for (const [index, span] of [[60, 61], [2, 40], [2, 10], null].entries()) {
  rows.push(sourceOrderEntry({ kind: 'expression', span }, { partitionId, localId: pathIndex * 4 + index }, sourcePath));
}
rows.sort(compareOperationIndexRows);
const makeArtifact = (entries = rows) => {
  const index = { schemaVersion: SEMANTIC_OPERATION_INDEX_VERSION, generation,
    partitionHashes: [{ partitionId, canonicalHash }], rowCount: entries.length,
    pieces: [{ path: 'rows.jsonl', offsetsPath: 'rows.offsets', hash: canonicalHash, offsetsHash: canonicalHash,
      count: entries.length, bytes: 65536, firstRow: 0, firstKey: entries[0], lastKey: entries[entries.length - 1] }] };
  let reads = 0;
  const find = createArtifactOperationReader({ index, generation, inventory: new Map([[partitionId, { partitionId, canonicalHash }]]),
    readPieceRows: async (_piece, ordinals) => { reads += ordinals.length; return ordinals.map(ordinal => structuredClone(entries[ordinal])); } });
  return { findOperationsInSourceOrder: find.inSourceOrder, listOperationSourcePaths: find.listSourcePaths, index, reads: () => reads };
};
const native = new DatabaseSync(':memory:');
const db = { prepare: sql => native.prepare(sql), exec: sql => native.exec(sql), get inTransaction() { return native.isTransaction; } };
db.exec(CREATE_SEMANTIC_TABLES_SQL);
db.exec('CREATE TABLE index_format_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL)');
db.prepare('INSERT INTO index_format_meta VALUES (?,?)').run(SOURCE_ORDER_META_KEY, SOURCE_ORDER_VERSION);
db.prepare('INSERT INTO semantic_analysis VALUES (?,?,?,?)').run(partitionId, 'unused-source', canonicalHash, '{}');
const insert = db.prepare('INSERT INTO semantic_discovery VALUES (?,?,?,?)');
for (const row of rows) insert.run(row.ref.partitionId, row.ref.localId, row.field, row.value);
const collectPaths = async (store, prefix, limit) => {
  const result = []; let after = null, iterations = 0;
  do {
    const page = await store.listOperationSourcePaths({ prefix, after, limit });
    result.push(...page.paths); after = page.after;
    if (page.done) return result;
    assert.ok(++iterations < 32, 'bounded progress to the exact selected inventory');
  } while (true);
};
try {
  const artifact = makeArtifact(), sqlite = createSqliteSourceOrderReader(db);
  if (mode === 'prefix-and-unicode') {
    const expected = ['src/http', 'src/http/a.js', 'src/http/nested/x.js', 'src/http/😀.js', 'src/http/\ue000.js'];
    assert.deepEqual([...expected].sort(), expected, 'UTF-16 path ordering distinguishes astral and private-use characters');
    for (const store of [artifact, sqlite]) for (const limit of [1, 2, 32]) {
      assert.deepEqual(await collectPaths(store, 'src/http', limit), expected);
      assert.deepEqual(await collectPaths(store, 'src/http/missing', limit), []);
    }
    const many = Array.from({ length: 4096 }, (_, localId) => sourceOrderEntry({ kind: 'expression', span: [localId, localId + 1] }, { partitionId, localId }, 'src/http/a.js'));
    const indexed = makeArtifact(many);
    assert.deepEqual(await collectPaths(indexed, 'src/http', 1), ['src/http/a.js']);
    assert.ok(indexed.reads() < 100, 'enumeration jumps across an entire file rather than visiting each operation');
  } else if (mode === 'keyset-and-order') {
    for (const store of [artifact, sqlite]) for (const limit of [1, 3, 128]) {
      let after = null, ids = [], iterations = 0;
      do {
        const page = await store.findOperationsInSourceOrder('src/http/a.js', { after, limit });
        ids.push(...page.refs.map(ref => ref.localId)); after = page.after;
        if (page.done) break;
        assert.ok(++iterations < 8);
      } while (true);
      assert.deepEqual(ids, [10, 9, 8, 11], 'numeric spans precede ref order; unknown spans remain enumerable');
      assert.deepEqual((await store.findOperationsInSourceOrder('absent.js')).refs, []);
    }
    const first = await artifact.findOperationsInSourceOrder('src/http/a.js', { limit: 1 });
    const replay = await artifact.findOperationsInSourceOrder('src/http/a.js', { after: first.after });
    assert.deepEqual(replay, await sqlite.findOperationsInSourceOrder('src/http/a.js', { after: first.after }));
  } else if (mode === 'bounds-and-stale') {
    for (const store of [artifact, sqlite]) {
      for (const prefix of ['', '../src', 'src//http', 'C:/src', 'src\\http', 'src/./http']) {
        await assert.rejects(store.listOperationSourcePaths({ prefix }));
      }
      await assert.rejects(store.listOperationSourcePaths({ prefix: 'src/http', after: 'src/httpology/x.js' }));
      await assert.rejects(store.listOperationSourcePaths({ prefix: 'src/http', limit: 33 }));
      let reads = 0;
      await assert.rejects(store.listOperationSourcePaths({ get prefix() { reads++; return 'src/http'; } }));
      assert.equal(reads, 0, 'source selectors are copied as own data before I/O');
      const controller = new AbortController(); controller.abort();
      await assert.rejects(store.listOperationSourcePaths({ prefix: 'src/http' }, { signal: controller.signal }), { name: 'AbortError' });
      const wrong = await store.findOperationsInSourceOrder('src/http.js', { limit: 1 });
      await assert.rejects(store.findOperationsInSourceOrder('src/http', { after: wrong.after }));
    }
    db.prepare('DELETE FROM index_format_meta WHERE key=?').run(SOURCE_ORDER_META_KEY);
    await assert.rejects(createSqliteSourceOrderReader(db).listOperationSourcePaths({ prefix: 'src' }), { code: 'ERR_SEMANTIC_UNAVAILABLE' });
    artifact.index.schemaVersion--;
    const old = createArtifactOperationReader({ index: artifact.index, inventory: new Map(), generation, readPieceRows: () => { throw new Error('unexpected I/O'); } });
    await assert.rejects(old.listSourcePaths({ prefix: 'src' }), /Invalid semantic operation index/);
    assert.throws(() => decodeSourceOrderPath('garbage'), /Invalid semantic source-order key/);
  } else {
    const fixture = await createRecoveryFixture('first(); second();');
    try {
      const first = semanticNode(0, 8), second = semanticNode(1, 5);
      first.row.span = [9, 17]; second.row.span = [0, 5];
      const descriptor = await fixture.write([first, second]), base = fixture.store([descriptor]);
      const operationIndex = await writeSemanticQueryIndex({ root: fixture.stagingRoot, generation: fixture.generation,
        partitions: [descriptor], store: base, diskAccount: fixture.account, entries: operationIndexEntries(base, [descriptor]),
        compareRows: compareOperationIndexRows, keyForRow: row => row, validateIndex: assertSemanticOperationIndex,
        schemaVersion: SEMANTIC_OPERATION_INDEX_VERSION, directoryPrefix: 'semantic-operation-index-' });
      const physical = fixture.store([descriptor], { operationIndex });
      db.exec('BEGIN');
      await ingestSemanticPartition({ db, store: base, descriptor });
      db.prepare('DELETE FROM index_format_meta WHERE key=?').run(SOURCE_ORDER_META_KEY);
      const plan = { entries: [{ factsRef: { sourceUnitId: descriptor.sourceUnitId } }], partitions: [descriptor], store: base, generation: fixture.generation };
      assert.equal((await applyCachedSemanticPlan({ db, plan })).changedPartitions, 1, 'old canonical partitions rebuild their missing derived projection');
      assert.equal((await applyCachedSemanticPlan({ db, plan })).changedPartitions, 0, 'qualified equal partitions retain the normal incremental no-op');
      db.exec('COMMIT');
      const projected = createSqliteSourceOrderReader(db);
      assert.deepEqual(await physical.findOperationsInSourceOrder('original.js'), await projected.findOperationsInSourceOrder('original.js'));
      assert.deepEqual((await physical.findOperationsInSourceOrder('original.js')).refs.map(ref => ref.localId), [1, 0]);
      assert.deepEqual(await collectPaths(physical, 'original.js', 1), ['original.js']);
      assert.deepEqual(await collectPaths(projected, 'original.js', 1), ['original.js']);
      assert.equal(fixture.account.used > 0, true, 'derived bytes stay charged to the original writer account');
    } finally { await fixture.cleanup(); }
  }
} finally { native.close(); }
console.log('Semantic source enumeration and ordered keyset pages preserve exact artifact/SQLite inputs.');
