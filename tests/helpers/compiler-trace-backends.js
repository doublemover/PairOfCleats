import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { ARTIFACT_SURFACE_VERSION } from '../../src/contracts/versioning.js';
import { SCHEMA_VERSION } from '../../src/storage/sqlite/schema.js';
import { CREATE_SEMANTIC_TABLES_SQL } from '../../src/storage/sqlite/semantic/schema.js';
import { writeSqliteIndexFormat } from '../../src/storage/sqlite/index-format.js';
import { ingestSemanticPartition } from '../../src/storage/sqlite/semantic/ingest.js';
import { createArtifactSemanticStore } from '../../src/semantic/artifact-store.js';
import { createSqliteSemanticStore } from '../../src/semantic/sqlite-store.js';
import { createSemanticTraceService } from '../../src/semantic/trace.js';
import { writeSemanticQueryIndex } from '../../src/index/build/artifacts/writers/semantic/query-index.js';
import { canonicalSemanticJson } from '../../src/index/semantic/identity.js';

export const drainSemanticTrace = async ({ store, repoRoot, generation, seed,
  direction = 'downstream', limits = { records: 3, edges: 3, bytes: 65536, depth: 64 } }) => {
  const service = createSemanticTraceService(), aggregate = { records: [], edges: [], evidenceRefs: [] };
  const seenEvidence = new Set();
  const request = { repoRoot, generation, seed, direction, limits };
  let cursor = null, pages = 0;
  do {
    const page = await service({ store, request: { ...request, cursor } });
    assert.ok(!page.frontier.some(item => ['depth_budget', 'visited_budget', 'call_context_budget', 'record_not_found'].includes(item.reason)),
      'A negative reachability assertion requires exhaustion of the supported bounded graph.');
    aggregate.records.push(...page.records);
    aggregate.edges.push(...page.edges);
    for (const ref of page.evidenceRefs) {
      const key = canonicalSemanticJson(ref);
      if (seenEvidence.has(key)) continue;
      seenEvidence.add(key);
      aggregate.evidenceRefs.push(ref);
    }
    cursor = page.cursor;
    assert.ok(++pages < 1000, 'bounded trace continuation advances to exhaustion');
  } while (cursor);
  return aggregate;
};

/** Produce both real query backends from one compiler fixture's immutable facts. */
export const createCompilerTraceBackends = async (fixture, partitions) => {
  const base = fixture.storeFor(partitions), generation = [...fixture.state.semanticFactsByFile.values()][0].storage.generation;
  const queryIndex = await writeSemanticQueryIndex({ root: fixture.stagingRoot, generation, partitions, store: base,
    diskAccount: fixture.state.semanticDiskAccount, batchRows: 128, batchBytes: 65536, maxOpenRuns: 2 });
  const artifact = createArtifactSemanticStore({ root: fixture.stagingRoot, repoRoot: fixture.group.repoRoot,
    artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, generation, partitions, queryIndex });
  return createSemanticTraceParityBackends({ artifact, partitions, generation, repoRoot: fixture.group.repoRoot });
};

/** Existing published artifact handles are retained; parity never writes to an
 * immutable published family. SQLite is a separate in-memory test projection.
 */
export const createSemanticTraceParityBackends = async ({ artifact, partitions, generation, repoRoot,
  limits = { records: 3, edges: 3, bytes: 65536, depth: 64 } }) => {
  const db = new Database(':memory:');
  try {
    db.pragma('user_version = ' + SCHEMA_VERSION); db.exec(CREATE_SEMANTIC_TABLES_SQL); writeSqliteIndexFormat(db);
    db.exec('BEGIN');
    for (const descriptor of partitions) await ingestSemanticPartition({ db, store: artifact, descriptor });
    db.exec('COMMIT');
    db.prepare('INSERT INTO index_format_meta(key,value) VALUES (?,?)').run('semanticGeneration', JSON.stringify(generation));
    const sqlite = createSqliteSemanticStore({ db, repoRoot, indexPath: ':memory:',
      generation, artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION });
    const drain = (store, seed, direction) => drainSemanticTrace({ store, repoRoot, generation, seed, direction, limits });
    return { artifact, sqlite, close: () => db.close(),
      traceArtifact: (seed, direction = 'downstream') => drain(artifact, seed, direction),
      async trace(seed, direction = 'downstream') {
        const [actual, sqliteActual] = await Promise.all([
          drain(artifact, seed, direction), drain(sqlite, seed, direction)
        ]);
        assert.deepEqual(sqliteActual, actual, 'fully drained compiler trace backend parity');
        return actual;
      } };
  } catch (error) { db.close(); throw error; }
};
