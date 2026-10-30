import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { createRecoveryFixture, semanticNode, sha256 } from '../../helpers/semantic-recovery.js';
import { createAnalysisPartitionId } from '../../../src/index/semantic/identity.js';
import { createSemanticDetailService } from '../../../src/semantic/detail.js';
import { createSemanticFindService } from '../../../src/semantic/find.js';
import { createSemanticTraceService } from '../../../src/semantic/trace.js';
import { createSqliteSemanticStore } from '../../../src/semantic/sqlite-store.js';
import { operationIndexEntries, compareOperationIndexRows } from '../../../src/semantic/operation-index.js';
import { writeSemanticQueryIndex } from '../../../src/index/build/artifacts/writers/semantic/query-index.js';
import { assertSemanticOperationIndex } from '../../../src/contracts/validators/semantic-operation-index.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { SCHEMA_VERSION } from '../../../src/storage/sqlite/schema.js';
import { CREATE_SEMANTIC_TABLES_SQL } from '../../../src/storage/sqlite/semantic/schema.js';
import { writeSqliteIndexFormat } from '../../../src/storage/sqlite/index-format.js';
import { ingestSemanticPartition } from '../../../src/storage/sqlite/semantic/ingest.js';

// Exact source bytes include a BOM, CRLF and a surrogate pair. The query owner
// must retain these coordinates; document normalization belongs to the editor.
const text = '\uFEFFfirst("\u{1F642}");\r\nsecond();';
const fixture = await createRecoveryFixture(text);
let db;
try {
  const ref = localId => ({ partitionId: fixture.partitionId, localId });
  const first = semanticNode(0, text.indexOf('\r'));
  first.row.span[0] = 1;
  const second = semanticNode(1, text.length);
  second.row.span[0] = text.indexOf('second');
  const noSpan = semanticNode(2, text.length);
  noSpan.row.span = null;
  const syntax = await fixture.write([first, second, noSpan, {
    family: 'edge', row: { id: 0, kind: 'flowsTo', from: ref(0), to: ref(1),
      evidence: null, callSite: null, operandOrdinal: null, contextKey: null,
      condition: null, certainty: 'modeled' }
  }]);
  const analysisId = createAnalysisPartitionId({
    pass: { name: 'source-reference-fixture', version: '1' },
    inputPartitionHashes: [syntax.canonicalHash], compilerContext: null,
    dependencySummaryHashes: [], analysisPolicy: {}
  });
  const analysis = await fixture.write([semanticNode(0, text.length)], { partitionId: analysisId });
  const partitions = [syntax, analysis];
  const base = fixture.store(partitions);
  const queryIndex = await writeSemanticQueryIndex({ root: fixture.stagingRoot,
    generation: fixture.generation, partitions, store: base, diskAccount: fixture.account });
  const operationIndex = await writeSemanticQueryIndex({ root: fixture.stagingRoot,
    generation: fixture.generation, partitions, store: base, diskAccount: fixture.account,
    entries: operationIndexEntries(base, partitions), compareRows: compareOperationIndexRows,
    keyForRow: row => row, validateIndex: assertSemanticOperationIndex,
    schemaVersion: 2, directoryPrefix: 'semantic-operation-index-' });
  const artifact = fixture.store(partitions, { queryIndex, operationIndex });
  db = new Database(':memory:');
  db.pragma('user_version = ' + SCHEMA_VERSION);
  db.exec(CREATE_SEMANTIC_TABLES_SQL);
  writeSqliteIndexFormat(db);
  db.exec('BEGIN');
  for (const descriptor of partitions) await ingestSemanticPartition({ db, store: base, descriptor });
  db.exec('COMMIT');
  db.prepare('INSERT INTO index_format_meta(key,value) VALUES (?,?)')
    .run('semanticGeneration', JSON.stringify(fixture.generation));
  const sqlite = createSqliteSemanticStore({ db, repoRoot: fixture.root, indexPath: ':memory:',
    generation: fixture.generation, artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION });
  const common = { repoRoot: fixture.root, generation: fixture.generation };
  const expected = record => ({ ref: record.ref, sourceUnitId: fixture.source.sourceUnitId,
    sourceHash: sha256(fixture.bytes), path: 'original.js', coordinateUnit: 'utf16' });
  const verify = page => {
    assert.ok(Buffer.byteLength(JSON.stringify(page)) <= 16384);
    assert.deepEqual(page.sourceRefs, page.records.filter(row => row.span).map(expected));
    for (const source of page.sourceRefs) {
      assert.ok(page.records.some(row => row.ref.partitionId === source.ref.partitionId
        && row.ref.localId === source.ref.localId), 'pins refer only to this page');
    }
  };
  const collect = async (service, store, request) => {
    const records = [], sourceRefs = [];
    let cursor = null, pages = 0;
    do {
      const page = await service({ store, request: { ...common, ...request, cursor } });
      verify(page);
      records.push(...page.records);
      sourceRefs.push(...page.sourceRefs);
      cursor = page.cursor;
      assert.ok(++pages < 16, 'source metadata must not stall record continuations');
    } while (cursor);
    return { records, sourceRefs };
  };
  for (const store of [artifact, sqlite]) {
    const requests = [
      [createSemanticDetailService, { refs: [ref(0), ref(1), ref(2),
        { partitionId: analysisId, localId: 0 }], limits: { records: 1, bytes: 16384 } }],
      [createSemanticFindService, { selector: { field: 'sourcePath', value: 'original.js' },
        limits: { records: 1, bytes: 16384 } }],
      [createSemanticTraceService, { seed: ref(0), direction: 'downstream',
        limits: { records: 1, edges: 1, depth: 4, bytes: 16384 } }]
    ];
    for (const [create, request] of requests) {
      const actual = await collect(create(), store, request);
      const withoutMetadata = { ...store, getSourceReference: undefined };
      const service = create();
      const unpinned = [];
      let cursor = null;
      do {
        const page = await service({ store: withoutMetadata, request: { ...common, ...request, cursor } });
        unpinned.push(...page.records);
        assert.deepEqual(page.sourceRefs, []);
        cursor = page.cursor;
      } while (cursor);
      assert.deepEqual(actual.records, unpinned, 'optional pins preserve all selected content');
      assert.ok(actual.sourceRefs.some(row => row.ref.localId === 0));
    }
    const projected = await createSemanticDetailService()({ store,
      request: { ...common, refs: [ref(0)], fields: ['data'] } });
    assert.deepEqual(projected.sourceRefs, [], 'omitted spans do not imply precise navigation');
    await assert.rejects(createSemanticDetailService()({ store,
      request: { ...common, generation: { ...fixture.generation, baseBuildId: 'stale' }, refs: [ref(0)] } }),
    { code: 'ERR_SEMANTIC_GENERATION_MISMATCH' });
  }
  const detailRequest = { ...common, refs: [ref(0), ref(1)], limits: { records: 1 } };
  const service = createSemanticDetailService();
  const page = await service({ store: artifact, request: detailRequest });
  await assert.rejects(service({ store: sqlite, request: { ...detailRequest, cursor: page.cursor } }),
    { code: 'ERR_SEMANTIC_CURSOR_EXPIRED' });
  const [record] = await artifact.getRecords([ref(0)]);
  assert.equal(text.slice(...record.span), 'first("\u{1F642}");');
  assert.equal(fixture.source.lineStarts[1], text.indexOf('second'));
  console.log('Semantic source reference projections retain exact source authority and cursor content');
} finally {
  if (db) db.close();
  await fixture.cleanup();
}
