import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';
import { createRecoveryFixture, semanticNode } from '../../helpers/semantic-recovery.js';
import { writeSemanticQueryIndex } from '../../../src/index/build/artifacts/writers/semantic/query-index.js';
import { operationIndexEntries, compareOperationIndexRows } from '../../../src/semantic/operation-index.js';
import { assertSemanticOperationIndex } from '../../../src/contracts/validators/semantic-operation-index.js';
import { createNeighborReader } from '../../../src/semantic/neighbors.js';
import { createSqliteSemanticStore } from '../../../src/semantic/sqlite-store.js';
import { SCHEMA_VERSION } from '../../../src/storage/sqlite/schema.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { CREATE_SEMANTIC_TABLES_SQL } from '../../../src/storage/sqlite/semantic/schema.js';
import { writeSqliteIndexFormat } from '../../../src/storage/sqlite/index-format.js';
import { ingestSemanticPartition } from '../../../src/storage/sqlite/semantic/ingest.js';

// UNVALIDATED. Actual retained operation/incident indexes and SQLite ingestion;
// no native, provider or supported runtime qualification is implied.
const f = await createRecoveryFixture('owned selection');
const originalOpen = fs.open;
let db;
try {
  const ref = localId => ({ partitionId: f.partitionId, localId });
  const call = semanticNode(1, f.source.textLength); call.row.data.astKind = 'CallExpression';
  const edge = (id, from, to, kind) => ({ family: 'edge', row: {
    id, from: ref(from), to: ref(to), kind, callSite: null, operandOrdinal: null,
    contextKey: null, condition: null, evidence: null, certainty: 'exact-static'
  } });
  const partition = await f.write([semanticNode(0, f.source.textLength), call,
    edge(0, 0, 1, 'flowsTo'), edge(1, 1, 0, 'flowsTo'), edge(2, 0, 0, 'reads')]);
  const base = f.store([partition]);
  const options = { root: f.stagingRoot, generation: f.generation,
    partitions: [partition], store: base, diskAccount: f.account };
  const queryIndex = await writeSemanticQueryIndex(options);
  const operationIndex = await writeSemanticQueryIndex({ ...options,
    entries: operationIndexEntries(base, [partition]), compareRows: compareOperationIndexRows,
    keyForRow: row => row, validateIndex: assertSemanticOperationIndex,
    directoryPrefix: 'semantic-operation-index-', schemaVersion: 2 });
  const artifact = f.store([partition], { queryIndex, operationIndex });
  const selector = { field: 'astKind', value: 'Identifier' };
  const operationFiles = new Set(operationIndex.pieces.map(piece => path.resolve(f.stagingRoot, piece.path)));
  let changes = 0;
  const handles = [];
  fs.open = async (file, ...args) => {
    const handle = await originalOpen.call(fs, file, ...args); handles.push(handle);
    if (operationFiles.has(path.resolve(String(file)))) {
      const nativeRead = handle.read;
      handle.read = function (...readArgs) {
        assert.equal(this, handle);
        if (!changes++) { selector.field = 'sourcePath'; selector.value = 'changed.js'; }
        return nativeRead.apply(handle, readArgs);
      };
    }
    return handle;
  };
  await artifact.withReadScope(async () => {
    const first = await artifact.findOperations(selector);
    assert.deepEqual(first.refs, [ref(0)]);
    assert.deepEqual(await artifact.findOperations({ field: 'astKind', value: 'Identifier' }), first,
      'the range registered before the await belongs to its captured selector');
    assert.deepEqual((await artifact.findOperations({ field: 'astKind', value: 'CallExpression' })).refs, [ref(1)]);
    assert.deepEqual((await artifact.findOperations(selector)).refs, []);
  });
  fs.open = originalOpen;
  assert.ok(changes > 0);
  assert.ok(handles.every(handle => handle.fd === -1));

  const originalRef = ref(0), kinds = ['flowsTo'], pageOptions = { offset: 0, limit: 128 };
  const neighbors = createNeighborReader(async (ownedRef, member, ownedOptions) => {
    assert.ok(Object.isFrozen(ownedRef) && Object.isFrozen(ownedOptions));
    const page = await artifact.getRelatedPage(ownedRef, member, ownedOptions);
    originalRef.localId = 1; kinds[0] = 'reads'; pageOptions.offset = 500;
    return page;
  });
  const page = await neighbors(originalRef, 'downstream', kinds, pageOptions);
  assert.deepEqual(page.edges.map(value => value.id), [0]);
  assert.deepEqual(page.entries.map(value => value.offset), [1, 2, 3]);
  assert.deepEqual(page.entries.map(value => value.edge?.id ?? null), [0, null, null]);
  assert.equal(page.offset, 3); assert.equal(page.done, true);
  const duplicateKinds = await artifact.getNeighbors(ref(0), 'downstream', Array(4096).fill('flowsTo'));
  assert.deepEqual(duplicateKinds.edges, page.edges);
  const upstream = await artifact.getNeighbors(ref(0), 'upstream', ['flowsTo']);
  assert.deepEqual(upstream.edges.map(value => value.id), [1]);

  db = new Database(':memory:'); db.pragma('user_version = ' + SCHEMA_VERSION);
  db.exec(CREATE_SEMANTIC_TABLES_SQL); writeSqliteIndexFormat(db);
  db.exec('BEGIN'); await ingestSemanticPartition({ db, store: base, descriptor: partition }); db.exec('COMMIT');
  db.prepare('INSERT INTO index_format_meta(key,value) VALUES (?,?)').run('semanticGeneration', JSON.stringify(f.generation));
  let onSql = null, onPrepare = null;
  const observedDb = {
    pragma: (...args) => db.pragma(...args),
    prepare(sql) {
      onPrepare?.(sql);
      const statement = db.prepare(sql);
      return new Proxy(statement, { get(target, key) {
        const value = target[key];
        if (typeof value !== 'function') return value;
        return (...args) => { onSql?.(sql); return value.apply(target, args); };
      } });
    }
  };
  const sqlite = createSqliteSemanticStore({ db: observedDb, repoRoot: f.root, indexPath: ':memory:',
    artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, generation: f.generation });
  const suppliedRef = ref(0), suppliedRefs = [suppliedRef], fields = ['span'];
  onSql = sql => {
    if (!sql.includes('FROM semantic_records WHERE partition_id')) return;
    suppliedRef.localId = 1; suppliedRefs[0] = ref(1); fields[0] = 'data'; fields.push('unknown');
  };
  const result = await sqlite.getRecords(suppliedRefs, fields);
  assert.deepEqual(result[0].ref, ref(0));
  assert.ok(Object.isFrozen(result[0].ref));
  assert.equal(Object.hasOwn(result[0], 'data'), false);
  assert.deepEqual(result[0].omittedFieldGroups, ['scope', 'data']);
  const sqlSelector = { field: 'astKind', value: 'Identifier' };
  onSql = null;
  onPrepare = () => { sqlSelector.field = 'sourcePath'; sqlSelector.value = 'changed.js'; };
  assert.deepEqual((await sqlite.findOperations(sqlSelector)).refs, [ref(0)]);
  onPrepare = null;
  const relatedRef = ref(0);
  onSql = () => { relatedRef.localId = 1; };
  assert.deepEqual((await sqlite.getRelatedPage(relatedRef, 'semantic_edges')).rows.map(value => value.id), [0, 1, 2]);
  onSql = null;
  assert.deepEqual(await sqlite.getNeighbors(ref(0), 'downstream', ['flowsTo']),
    await artifact.getNeighbors(ref(0), 'downstream', ['flowsTo']));

  let getters = 0;
  const accessorSelector = Object.defineProperty({ field: 'astKind' }, 'value', {
    enumerable: true, get() { getters++; return 'Identifier'; }
  });
  for (const store of [artifact, sqlite]) {
    await assert.rejects(store.findOperations(accessorSelector), TypeError);
    await assert.rejects(store.findOperations({ field: 'astKind', value: 'Identifier', extra: true }), TypeError);
    await assert.rejects(store.findOperations({ field: 'astKind', value: 'x'.repeat(4097) }), TypeError);
    await assert.rejects(store.getNeighbors(ref(0), 'downstream', new Array(1)), TypeError);
    const accessorKinds = Object.defineProperty([], '0', { get() { getters++; return 'flowsTo'; } });
    await assert.rejects(store.getNeighbors(ref(0), 'downstream', accessorKinds), TypeError);
    const pending = Object.freeze(Object.assign(new Error('selector reflection owns work'), {
      cacheOwnershipReleased: () => false
    }));
    const reflected = new Proxy({ field: 'astKind', value: 'Identifier' }, {
      getOwnPropertyDescriptor() { throw pending; }
    });
    await assert.rejects(store.findOperations(reflected), error => error === pending);
  }
  assert.equal(getters, 0);
  console.log('Direct semantic selection stays owned across async readers and database callbacks');
} finally {
  fs.open = originalOpen;
  if (db?.inTransaction) db.exec('ROLLBACK');
  db?.close();
  await f.cleanup();
}
