import { buildSemanticContextSection } from '../../../src/context-pack/semantic.js';
import { createSemanticDetailService } from '../../../src/semantic/detail.js';
import { createSemanticTraceService } from '../../../src/semantic/trace.js';
import { SEMANTIC_CONTEXT_SCHEMA } from '../../../src/contracts/schemas/semantic-context.js';
import { compileSchema, createAjv } from '../../../src/shared/validation/ajv-factory.js';
import { attachSemanticContextSection } from '../../../src/context-pack/assemble/finalize.js';
import { buildContextPackRequestInput, buildCliContextPackRequestInput } from '../../../src/shared/context-pack-request.js';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createRecoveryFixture, semanticNode } from '../../helpers/semantic-recovery.js';
import { operationIndexEntries, compareOperationIndexRows } from '../../../src/semantic/operation-index.js';
import { writeSemanticQueryIndex } from '../../../src/index/build/artifacts/writers/semantic/query-index.js';
import { assertSemanticOperationIndex } from '../../../src/contracts/validators/semantic-operation-index.js';
import { createSemanticFindService } from '../../../src/semantic/find.js';
import { createSqliteSemanticStore } from '../../../src/semantic/sqlite-store.js';
import { ingestSemanticPartition } from '../../../src/storage/sqlite/semantic/ingest.js';
import { CREATE_SEMANTIC_TABLES_SQL } from '../../../src/storage/sqlite/semantic/schema.js';
import { SCHEMA_VERSION } from '../../../src/storage/sqlite/schema.js';
import { writeSqliteIndexFormat } from '../../../src/storage/sqlite/index-format.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
const fixture = await createRecoveryFixture('first(); second();');
const native = new DatabaseSync(':memory:');
// Exercise the real SQLite schema and SQL without downloading a native addon.
const db = { prepare: sql => native.prepare(sql), exec: sql => native.exec(sql),
  pragma: name => Object.values(native.prepare('PRAGMA ' + name).get())[0],
  get inTransaction() { return native.isTransaction; } };
try {
  const ref = localId => ({ partitionId: fixture.partitionId, localId });
  const partition = await fixture.write([
    semanticNode(0, 7), semanticNode(1, fixture.source.textLength), semanticNode(2, fixture.source.textLength),
    { family: 'ownership', row: { recordRef: ref(0), chunkUid: 'chunk-a', role: 'primary' } },
    { family: 'ownership', row: { recordRef: ref(0), chunkUid: 'chunk-b', role: 'overlap' } },
    { family: 'ownership', row: { recordRef: ref(1), chunkUid: 'chunk-a', role: 'overlap' } }
  ]);
  const base = fixture.store([partition]);
  const index = await writeSemanticQueryIndex({ root: fixture.stagingRoot, generation: fixture.generation,
    partitions: [partition], store: base, diskAccount: fixture.account,
    entries: operationIndexEntries(base, [partition]), compareRows: compareOperationIndexRows,
    keyForRow: row => row, validateIndex: assertSemanticOperationIndex,
    schemaVersion: 2, directoryPrefix: 'semantic-operation-index-', batchRows: 3, batchBytes: 4096 });
  const queryIndex = await writeSemanticQueryIndex({ root: fixture.stagingRoot, generation: fixture.generation, partitions: [partition], store: base, diskAccount: fixture.account });
  const artifact = fixture.store([partition], { operationIndex: index, queryIndex });
  db.exec('PRAGMA user_version = ' + SCHEMA_VERSION); db.exec(CREATE_SEMANTIC_TABLES_SQL); writeSqliteIndexFormat(db);
  db.exec('BEGIN'); await ingestSemanticPartition({ db, store: base, descriptor: partition }); db.exec('COMMIT');
  db.prepare('INSERT INTO index_format_meta(key,value) VALUES (?,?)').run('semanticGeneration', JSON.stringify(fixture.generation));
  const sqlite = createSqliteSemanticStore({ db, repoRoot: fixture.root, indexPath: ':memory:',
    generation: fixture.generation, artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION });
  const discover = async (store, selector) => {
    const find = createSemanticFindService(), ids = []; let cursor = null;
    do {
      const page = await find({ store, request: { repoRoot: fixture.root, generation: fixture.generation,
        selector, limits: { records: 1 }, cursor } });
      ids.push(...page.records.map(row => row.id)); cursor = page.cursor;
      assert.ok(page.matches.every(row => row.category === (selector.field === 'chunkUid' ? 'ownership-candidate' : 'source-candidate')));
      assert.equal(page.status, 'partial', 'no coverage is not certified absence/completeness');
    } while (cursor);
    return ids;
  };
  for (const [selector, expected] of [
    [{ field: 'chunkUid', value: 'chunk-a' }, [0, 1]],
    [{ field: 'chunkUid', value: 'chunk-b' }, [0]],
    [{ field: 'sourcePath', value: 'original.js' }, [0, 1, 2]],
    [{ field: 'sourceUnitId', value: fixture.source.sourceUnitId }, [0, 1, 2]],
    [{ field: 'sourcePath', value: 'original.js', range: { start: 7, end: 8 } }, [1, 2]],
    [{ field: 'sourcePath', value: 'original.js', range: { start: 100, end: 101 } }, []],
    [{ field: 'sourcePath', value: 'absent.js' }, []]
  ]) {
    assert.deepEqual(await discover(artifact, selector), expected);
    assert.deepEqual(await discover(sqlite, selector), expected);
  }
  await assert.rejects(createSemanticFindService()({ store: artifact, request: { repoRoot: fixture.root, generation: fixture.generation, selector: { field: 'sourcePath', value: 'original.js', range: { start: 4, end: 4 } } } }), /nonempty/);
  const findService = createSemanticFindService(), detailService = createSemanticDetailService(), traceService = createSemanticTraceService();
  const options = { repoRoot: fixture.root, indexDir: fixture.stagingRoot, primary: { ref: { chunkUid: 'chunk-a' } },
    openStore: async () => ({ store: artifact }),
    find: request => findService({ store: artifact, request }),
    detail: request => detailService({ store: artifact, request }),
    trace: request => traceService({ store: artifact, request }) };
  const section = await buildSemanticContextSection(options);
  const ajv = createAjv({ allErrors: true, strict: true }), validate = compileSchema(ajv, SEMANTIC_CONTEXT_SCHEMA);
  assert.ok(validate(section), ajv.errorsText(validate.errors));
  assert.equal(section.status, 'partial'); assert.deepEqual(section.discovery.records.map(row => row.id), [0, 1]);
  assert.equal(section.excerpts[0].text, 'first()');
  assert.ok(section.followUps.every(row => row.request.repoRoot === fixture.root && row.request.generation.baseBuildId === fixture.generation.baseBuildId));
  assert.ok(Buffer.byteLength(JSON.stringify(section)) <= 65536);
  assert.equal(attachSemanticContextSection({ evidence: { complete: true } }, section).evidence.complete, false);
  assert.equal(buildContextPackRequestInput({ includeSemantic: true }).includeSemantic, true);
  assert.equal(buildCliContextPackRequestInput({ includeSemantic: true }).includeSemantic, true);
  const missing = await buildSemanticContextSection({ ...options, openStore: async () => { throw Object.assign(new Error('missing'), { code: 'ERR_SEMANTIC_UNAVAILABLE' }); } });
  assert.equal(missing.status, 'unavailable'); assert.ok(validate(missing));
  await assert.rejects(buildSemanticContextSection({ ...options, openStore: async () => { throw Object.assign(new Error('corrupt'), { code: 'ERR_SEMANTIC_INTEGRITY' }); } }), { code: 'ERR_SEMANTIC_INTEGRITY' });
  assert.throws(() => assertSemanticOperationIndex({ ...index, schemaVersion: 1 }), /Invalid semantic operation index/);
  console.log('Indexed chunk overlap and zero-chunk source discovery parity passed');
} finally { native.close(); await fixture.cleanup(); }
