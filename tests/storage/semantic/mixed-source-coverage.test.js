import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createRecoveryFixture, semanticNode } from '../../helpers/semantic-recovery.js';
import { createSemanticSourceSnapshot } from '../../../src/index/semantic/source.js';
import { createAnalysisPartitionId, createSyntaxPartitionId } from '../../../src/index/semantic/identity.js';
import { createSemanticFindService } from '../../../src/semantic/find.js';
import { createSemanticDetailService } from '../../../src/semantic/detail.js';
import { createSemanticTraceService } from '../../../src/semantic/trace.js';
import { createSqliteSemanticStore } from '../../../src/semantic/sqlite-store.js';
import { operationIndexEntries, compareOperationIndexRows } from '../../../src/semantic/operation-index.js';
import { writeSemanticQueryIndex } from '../../../src/index/build/artifacts/writers/semantic/query-index.js';
import { assertSemanticOperationIndex } from '../../../src/contracts/validators/semantic-operation-index.js';
import { ingestSemanticPartition } from '../../../src/storage/sqlite/semantic/ingest.js';
import { CREATE_SEMANTIC_TABLES_SQL } from '../../../src/storage/sqlite/semantic/schema.js';
import { SCHEMA_VERSION } from '../../../src/storage/sqlite/schema.js';
import { writeSqliteIndexFormat } from '../../../src/storage/sqlite/index-format.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { createSemanticCoverageQualification, qualifySemanticCoverage, semanticCoverageIsComplete } from '../../../src/semantic/coverage-qualification.js';

const coverage = (source, phase, state) => ({ family: 'coverage', row: {
  scope: { sourceUnitId: source.sourceUnitId }, phase, state, reason: state === 'complete' ? null : 'authored-incomplete',
  observedCount: 1, completedCount: state === 'complete' ? 1 : 0, frontierRef: null
} });

for (const state of ['missing', 'syntax-only', 'analysis-only', 'partial', 'deferred', 'unsupported', 'complete']) {
  const fixture = await createRecoveryFixture('first();');
  const native = new DatabaseSync(':memory:');
  const db = { prepare: sql => native.prepare(sql), exec: sql => native.exec(sql),
    pragma: name => Object.values(native.prepare('PRAGMA ' + name).get())[0],
    get inTransaction() { return native.isTransaction; } };
  try {
    const bytesB = Buffer.from('second();');
    const sourceB = createSemanticSourceSnapshot({ bytes: bytesB, repositoryNamespace: fixture.root,
      path: 'second.js', language: 'javascript' }).manifest;
    await fs.writeFile(path.join(fixture.root, 'second.js'), bytesB);
    const syntaxIdB = createSyntaxPartitionId({ sourceUnitId: sourceB.sourceUnitId,
      parser: { family: 'fixture', version: '1', options: {} }, extractor: { schemaVersion: 1, version: '1' },
      structuralPolicy: { structure: 'complete' } });
    const a = await fixture.write([semanticNode(0, fixture.source.textLength), coverage(fixture.source, 'syntax', 'complete')]);
    const b = await fixture.write([semanticNode(0, sourceB.textLength),
      ...(['missing', 'analysis-only'].includes(state) ? [] : [coverage(sourceB, 'syntax', 'complete')])],
    { source: sourceB, sourceBytes: bytesB, partitionId: syntaxIdB });
    const analysis = async (source, sourceBytes, syntax, analysisState) => fixture.write([
      coverage(source, 'localFlow', analysisState)
    ], { source, sourceBytes, partitionId: createAnalysisPartitionId({ pass: { name: 'mixed-coverage', version: '1' },
      inputPartitionHashes: [syntax.canonicalHash], compilerContext: null, dependencySummaryHashes: [], analysisPolicy: { state: analysisState } }) });
    const partitions = [a, b, await analysis(fixture.source, fixture.bytes, a, 'complete')];
    if (!['missing', 'syntax-only'].includes(state)) partitions.push(await analysis(sourceB, bytesB, b,
      state === 'analysis-only' ? 'complete' : state));
    const base = fixture.store(partitions);
    const operationIndex = await writeSemanticQueryIndex({ root: fixture.stagingRoot, generation: fixture.generation,
      partitions, store: base, diskAccount: fixture.account, entries: operationIndexEntries(base, partitions),
      compareRows: compareOperationIndexRows, keyForRow: row => row, validateIndex: assertSemanticOperationIndex,
      schemaVersion: 2, directoryPrefix: 'semantic-operation-index-', batchRows: 3, batchBytes: 4096 });
    const queryIndex = await writeSemanticQueryIndex({ root: fixture.stagingRoot, generation: fixture.generation,
      partitions, store: base, diskAccount: fixture.account });
    const artifact = fixture.store(partitions, { operationIndex, queryIndex });
    db.exec('PRAGMA user_version = ' + SCHEMA_VERSION); db.exec(CREATE_SEMANTIC_TABLES_SQL); writeSqliteIndexFormat(db);
    db.exec('BEGIN');
    for (const partition of partitions) await ingestSemanticPartition({ db, store: base, descriptor: partition });
    db.exec('COMMIT');
    db.prepare('INSERT INTO index_format_meta(key,value) VALUES (?,?)').run('semanticGeneration', JSON.stringify(fixture.generation));
    const sqlite = createSqliteSemanticStore({ db, repoRoot: fixture.root, indexPath: ':memory:',
      generation: fixture.generation, artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION });
    const refA = { partitionId: a.partitionId, localId: 0 }, refB = { partitionId: b.partitionId, localId: 0 };
    const common = { repoRoot: fixture.root, generation: fixture.generation };
    const expected = state === 'complete' ? 'complete' : 'partial';
    for (const store of [artifact, sqlite]) {
      // The analysis lives in a sibling partition, not on the selected syntax node.
      const aCoverage = await store.getCoverage([a.partitionId]);
      assert.ok(aCoverage.some(row => row.phase === 'localFlow' && row.partitionId !== a.partitionId));
      for (const refs of [[refA], [refB], [refA, refB], [refB, refA]]) {
        const wanted = refs.length === 1 && refs[0] === refA ? 'complete' : expected;
        for (const limit of [1, 8]) {
          const detail = createSemanticDetailService(); let cursor = null; const delivered = [];
          do {
            const page = await detail({ store, request: { ...common, refs, limits: { records: limit }, cursor } });
            delivered.push(...page.records.map(row => row.ref)); cursor = page.cursor;
            assert.equal(page.status, cursor ? 'partial' : wanted, `${store.backend} ${state} detail must retain whole-request qualification`);
            if (!cursor) assert.equal(page.coverage.response.state, 'complete', 'enumeration and analysis have separate verdicts');
            if (page.status === 'partial' && !cursor && wanted === 'partial') assert.ok(page.warnings.some(value => /coverage/.test(value)));
          } while (cursor);
          assert.deepEqual(delivered, refs);
        }
      }
      for (const limit of [1, 8]) {
        const find = createSemanticFindService(); let cursor = null; const delivered = [];
        do {
          const page = await find({ store, request: { ...common, selector: { field: 'astKind', value: 'Identifier' },
            limits: { records: limit }, cursor } });
          delivered.push(...page.records.map(row => row.ref)); cursor = page.cursor;
          assert.equal(page.status, cursor ? 'partial' : expected, `${store.backend} ${state} find must qualify both sources`);
          if (!cursor) assert.equal(page.coverage.response.state, 'complete');
        } while (cursor);
        assert.deepEqual(new Set(delivered.map(ref => ref.partitionId)), new Set([a.partitionId, b.partitionId]));
      }
      const empty = await createSemanticFindService()({ store, request: { ...common,
        selector: { field: 'astKind', value: 'AbsentKind' } } });
      assert.equal(empty.status, 'partial', 'exhaustion alone is not proof of absence');
      const bOnly = await createSemanticFindService()({ store, request: { ...common,
        selector: { field: 'sourcePath', value: 'second.js' } } });
      assert.equal(bOnly.status, expected);
      const trace = await createSemanticTraceService()({ store, request: { ...common, seed: refB, direction: 'downstream' } });
      assert.equal(trace.status, expected);
      const missingDetail = createSemanticDetailService();
      const missingRequest = { ...common, refs: [{ ...refA, localId: 999 }, refA, refB], limits: { records: 1 } };
      let missing = await missingDetail({ store, request: missingRequest });
      assert.equal(missing.status, 'partial'); assert.ok(missing.frontier.some(row => row.reason === 'record_not_found'));
      while (missing.cursor) missing = await missingDetail({ store, request: { ...missingRequest, cursor: missing.cursor } });
      assert.equal(missing.status, 'partial', 'a later complete page cannot erase a missing requested record');
    }
    const incomplete = qualifySemanticCoverage(createSemanticCoverageQualification(), []);
    const afterComplete = qualifySemanticCoverage(incomplete, aCoverageForMonotonicity(fixture.source));
    assert.equal(semanticCoverageIsComplete(afterComplete), false, 'complete unrelated evidence cannot erase an unknown scope');
  } finally {
    native.close(); await fixture.cleanup();
  }
}
function aCoverageForMonotonicity(source) {
  return [coverage(source, 'syntax', 'complete').row, coverage(source, 'localFlow', 'complete').row];
}
console.log('Semantic find/detail/trace retain per-source phase qualification across artifact/SQLite pages.');
