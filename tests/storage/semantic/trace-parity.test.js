import { assertSemanticOperationIndex } from '../../../src/contracts/validators/semantic-operation-index.js';
import { operationIndexEntries, compareOperationIndexRows } from '../../../src/semantic/operation-index.js';
import { createSemanticFindService } from '../../../src/semantic/find.js';
import { createSemanticExplainService } from '../../../src/semantic/explain.js';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';
import { createRecoveryFixture, semanticBatch } from '../../helpers/semantic-recovery.js';
import { parseJavaScriptAst } from '../../../src/lang/javascript/parse.js';
import { createSemanticCollector } from '../../../src/index/semantic/javascript-collector.js';
import { createSemanticPartitionSink } from '../../../src/index/build/artifacts/writers/semantic/partition.js';
import { writeSemanticQueryIndex } from '../../../src/index/build/artifacts/writers/semantic/query-index.js';
import { createArtifactSemanticStore } from '../../../src/semantic/artifact-store.js';
import { createSqliteSemanticStore } from '../../../src/semantic/sqlite-store.js';
import { createSemanticTraceService, DEFAULT_TRACE_KINDS } from '../../../src/semantic/trace.js';
import { createAnalysisPartitionId } from '../../../src/index/semantic/identity.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { SCHEMA_VERSION } from '../../../src/storage/sqlite/schema.js';
import { CREATE_SEMANTIC_TABLES_SQL } from '../../../src/storage/sqlite/semantic/schema.js';
import { writeSqliteIndexFormat } from '../../../src/storage/sqlite/index-format.js';
import { ingestSemanticPartition } from '../../../src/storage/sqlite/semantic/ingest.js';

const text = 'function work(input) { return call(1,2,3,4,5,{nested:[input,,...input], value:input}); }\r\nlarge(' + Array.from({ length: 300 }, (_, i) => i).join(',') + ');';
const fixture = await createRecoveryFixture(text);
let db;
try {
  const collector = createSemanticCollector({ ast: parseJavaScriptAst(text), source: fixture.source, partitionId: fixture.partitionId }, { batchRows: 128, batchBytes: 65536 });
  const sink = await createSemanticPartitionSink({ ...fixture.options, structuralSlots: collector.structuralSlots, batchRows: 128, batchBytes: 65536 });
  for (const batch of collector.batches) await sink.appendBatch(batch);
  const syntax = await sink.finalizeSource();
  const store = fixture.store([syntax]);
  const nodes = [];
  for await (const row of store.iterateRows(fixture.partitionId, 'semantic_records')) nodes.push(row);
  const call = nodes.find((row) => row.data.syntacticArgumentCount === 6);
  const large = nodes.find((row) => row.data.syntacticArgumentCount === 300);
  const ref = (localId) => ({ partitionId: fixture.partitionId, localId });
  const analysisId = createAnalysisPartitionId({ pass: { name: 'trace', version: 'fixture' }, inputPartitionHashes: [syntax.canonicalHash], compilerContext: null, dependencySummaryHashes: [], analysisPolicy: {} });
  const edgeSink = await createSemanticPartitionSink({ ...fixture.options, partitionId: analysisId });
  const refs = [call, large, nodes.find(row => row.kind === 'literal'), nodes.find(row => row.kind === 'expression' && row.id !== call.id && row.id !== large.id)].map(row => ref(row.id));
  const evidence = { partitionId: analysisId, localId: 0 };
  const edge = (id, from, to, kind = 'flowsTo') => ({ id, from, to, kind, callSite: null, operandOrdinal: null, contextKey: null, condition: null, evidence, certainty: 'exact-static' });
  const edges = [edge(0, refs[0], refs[1]), edge(1, refs[1], refs[2], 'copies'), edge(2, refs[2], refs[3], 'packs'), edge(3, refs[3], refs[0], 'transfers'), edge(4, refs[0], refs[0], 'reads'), edge(5, refs[0], ref(nodes.at(-1).id), 'callTarget')];
  await edgeSink.appendBatch(semanticBatch(analysisId, [
    { family: 'node', row: { id: 0, kind: 'evidence', span: null, scope: null, data: { method: 'fixture', producerId: 'trace', producerVersion: '1', evidenceKind: 'static', sourceRef: fixture.source.sourceUnitId, artifactRef: null } } },
    ...edges.map(row => ({ family: 'edge', row })),
    { family: 'coverage', row: { scope: { sourceUnitId: fixture.source.sourceUnitId }, phase: 'localFlow', state: 'partial', reason: 'fixture', observedCount: 6, completedCount: 5, frontierRef: null } }
  ]));
  const analysis = await edgeSink.finalizeSource(), partitions = [syntax, analysis], base = fixture.store(partitions);
  const index = await writeSemanticQueryIndex({ root: fixture.stagingRoot, generation: fixture.generation, partitions, store: base, diskAccount: fixture.account, batchRows: 17, batchBytes: 8192, maxOpenRuns: 2 });
  const operationIndex = await writeSemanticQueryIndex({ root: fixture.stagingRoot, generation: fixture.generation, partitions, store: base, diskAccount: fixture.account, entries: operationIndexEntries(base, partitions), compareRows: compareOperationIndexRows, keyForRow: row => row, validateIndex: assertSemanticOperationIndex, directoryPrefix: 'semantic-operation-index-', schemaVersion: 2, batchRows: 17, batchBytes: 8192, maxOpenRuns: 2 });
  const artifact = createArtifactSemanticStore({ root: fixture.stagingRoot, repoRoot: fixture.root, generation: fixture.generation, artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, partitions, operationIndex, queryIndex: index });
  db = new Database(':memory:'); db.pragma('user_version = ' + SCHEMA_VERSION); db.exec(CREATE_SEMANTIC_TABLES_SQL); writeSqliteIndexFormat(db);
  db.exec('BEGIN'); for (const descriptor of partitions) await ingestSemanticPartition({ db, store: base, descriptor }); db.exec('COMMIT');
  db.prepare('INSERT INTO index_format_meta(key,value) VALUES (?,?)').run('semanticGeneration', JSON.stringify(fixture.generation));
  const sqlite = createSqliteSemanticStore({ db, repoRoot: fixture.root, indexPath: ':memory:', generation: fixture.generation, artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION });
  const rows=async(store,member)=>{const result=[];for await(const row of store.iterateRows(fixture.partitionId,member,{batchRows:1}))result.push(row);return result;};
  assert.deepEqual(await rows(artifact,'semantic_sources'),await rows(sqlite,'semantic_sources'),'source inventory backend parity');
  assert.deepEqual(await rows(artifact,'semantic_frontier'),await rows(sqlite,'semantic_frontier'),'empty frontier backend parity');
  const explainRequest={repoRoot:fixture.root,generation:fixture.generation,seed:refs[0],direction:'downstream',limits:{records:2,edges:2,bytes:16384}};
  const explain=async(store)=>createSemanticExplainService()({store,manifest:{generation:fixture.generation,partitions,completedTasks:[]},request:explainRequest});
  const artifactExplanation=await explain(artifact),sqliteExplanation=await explain(sqlite);
  assert.deepEqual(sqliteExplanation.sourceRefs,artifactExplanation.sourceRefs,'source-pinned explain backend parity');
  assert.deepEqual(sqliteExplanation.enrichment,artifactExplanation.enrichment,'no invented pending work on either backend');
  const selector = {field:'astKind',value:call.data.astKind};
  const findAll = async store => {const service=createSemanticFindService(),records=[];let cursor=null;do {const page=await service({store,request:{repoRoot:fixture.root,generation:fixture.generation,selector,limits:{records:1},cursor}});records.push(...page.records);assert.ok(page.matches.every(match=>match.category==='structural-candidate'));cursor=page.cursor;}while(cursor);return records;};
  assert.deepEqual(await findAll(artifact),await findAll(sqlite),'operation selector pagination parity');
  const queryPlans = [];
  const observedDb = { pragma: (...args) => db.pragma(...args), prepare(sql) { if (sql.includes('FROM semantic_edges')) queryPlans.push(sql); return db.prepare(sql); } };
  createSqliteSemanticStore({ db: observedDb, repoRoot: fixture.root, indexPath: ':memory:', generation: fixture.generation, artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION });
  assert.ok(queryPlans.length >= 2);
  for (const sql of queryPlans) {
    const args = [analysisId, fixture.partitionId, call.id, analysisId, fixture.partitionId, call.id, ...(sql.includes('LIMIT ?') ? [1,0] : [])];
    const plan = db.prepare('EXPLAIN QUERY PLAN ' + sql).all(...args).map(row => row.detail).join(' ');
    assert.ok(plan.includes('semantic_edges_forward') && plan.includes('semantic_edges_reverse')); assert.ok(!plan.includes('SCAN semantic_edges'), 'only endpoint indexes select neighbor facts');
  }
  for (const direction of ['upstream', 'downstream']) {
    const drainNeighbors = async store => { const values = []; let offset = 0, done = false; while (!done) { const page = await store.getNeighbors(refs[0], direction, DEFAULT_TRACE_KINDS, { offset, limit: 1 }); values.push(...page.edges); assert.ok(page.offset > offset || page.done); offset = page.offset; done = page.done; } return values; };
    assert.deepEqual(await drainNeighbors(artifact), await drainNeighbors(sqlite));
    assert.equal((await drainNeighbors(artifact)).filter(row => row.id === 4).length, 1, 'self endpoint indexed once');
    const request = { repoRoot: fixture.root, generation: fixture.generation, seed: refs[0], direction, limits: { records: 2, edges: 2, bytes: 16384 } };
    const drain = async store => { const service = createSemanticTraceService(); const aggregate = { records: [], edges: [], evidenceRefs: [] }; let cursor = null, pages = 0; do { const result = await service({ store, request: { ...request, cursor } }); assert.equal(result.status, 'partial'); assert.ok(result.coverage.analysis.some(row => row.partitionId === analysisId)); assert.ok(result.coverage.extraction.some(row => row.partitionId === fixture.partitionId)); assert.ok(Buffer.byteLength(JSON.stringify(result)) <= request.limits.bytes); for (const field of Object.keys(aggregate)) aggregate[field].push(...result[field]); cursor = result.cursor; assert.ok(++pages < 30); } while (cursor); return aggregate; };
    const result = await drain(artifact); assert.deepEqual(await drain(sqlite), result, 'trace path and continuation parity');
    assert.equal(result.edges.length, 5); assert.equal(result.records.length, 5); assert.ok(!result.edges.some(row => row.kind === 'callTarget'));
    assert.ok(result.records.some(row => row.kind === 'evidence' && row.data.sourceRef === fixture.source.sourceUnitId));
    const service = createSemanticTraceService(); const first = await service({ store: artifact, request });
    await assert.rejects(service({ store: sqlite, request: { ...request, cursor: first.cursor } }), { code: 'ERR_SEMANTIC_CURSOR_EXPIRED' });
    await assert.rejects(service({ store: artifact, request: { ...request, direction: direction === 'upstream' ? 'downstream' : 'upstream', cursor: first.cursor } }), { code: 'ERR_SEMANTIC_CURSOR_EXPIRED' });
    await assert.rejects(service({ store: artifact, request: { ...request, generation: { ...fixture.generation, baseBuildId: 'other' } } }), { code: 'ERR_SEMANTIC_GENERATION_MISMATCH' });
    const controller = new AbortController(); controller.abort(); await assert.rejects(service({ store: artifact, request, signal: controller.signal }), /abort/i);
    const expired = createSemanticTraceService({ ttlMs: 1 }); const old = await expired({ store: artifact, request }); await new Promise(resolve => setTimeout(resolve, 3)); await assert.rejects(expired({ store: artifact, request: { ...request, cursor: old.cursor } }), { code: 'ERR_SEMANTIC_CURSOR_EXPIRED' });
  }
  const slotRequest = { repoRoot: fixture.root, generation: fixture.generation, seed: ref(call.id), direction: 'downstream', slot: { name: 'input', ordinal: 5 } };
  const slotA = await createSemanticTraceService()({ store: artifact, request: slotRequest });
  assert.equal(slotA.operands[0].ordinal, 5); assert.deepEqual(slotA.records[0].ref, slotA.operands[0].child);
  assert.deepEqual(await createSemanticTraceService()({ store: sqlite, request: slotRequest }), slotA);
  const depth = await createSemanticTraceService()({ store: artifact, request: { ...slotRequest, slot: { name: 'output', ordinal: 0 }, limits: { depth: 1 } } }); assert.ok(depth.frontier.some(row => row.reason === 'depth_budget')); assert.equal(depth.coverage.response.state, 'partial');
  const unavailable = await createSemanticTraceService()({ store: artifact, request: { ...slotRequest, slot: { name: 'argument', ordinal: 600 } } }); assert.equal(unavailable.cursor, null); assert.equal(unavailable.coverage.response.state, 'partial'); assert.ok(unavailable.frontier.some(row => row.reason === 'slot_unavailable'));
  const tight = createSemanticTraceService({ maxDepth: 1 }); await assert.rejects(tight({ store: artifact, request: { ...slotRequest, limits: { depth: 2 } } }), { code: 'ERR_SEMANTIC_QUERY_LIMIT' });
  const occurrence = nodes.find(row => row.kind === 'occurrence' && row.data.expression);
  const output = await createSemanticTraceService()({ store: artifact, request: { ...slotRequest, seed: ref(occurrence.id), slot: { name: 'output', ordinal: 0 } } }); assert.deepEqual(output.records[0].ref, occurrence.data.expression);
  const capService = createSemanticTraceService();
  const capRequest = { repoRoot: fixture.root, generation: fixture.generation, seed: ref(0), direction: 'downstream', limits: { depth: 1 } };
  const capStore = { ...artifact, storeId: 'visited-fixture', getCoverage: async () => [],
    getRecords: async ([value]) => [{ ...call, id: value.localId, ref: value, availableFieldGroups: ['span', 'scope', 'data'], omittedFieldGroups: [] }],
    getNeighbors: async (value, direction, kinds, { offset }) => value.localId === 0 && offset < 16384
      ? { edges: [{ ...edge(offset, ref(0), ref(offset + 1)), evidence: null }], offset: offset + 1, done: offset + 1 === 16384 }
      : { edges: [], offset, done: true } };
  let capCursor = null, hitVisited = false, capPages = 0;
  do { const page = await capService({ store: capStore, request: { ...capRequest, cursor: capCursor } }); assert.ok(page.records.length <= 128 && page.edges.length <= 512); assert.ok(Buffer.byteLength(JSON.stringify(page)) <= 65536); hitVisited = page.frontier.some(row => row.reason === 'visited_budget'); if (hitVisited) assert.equal(page.coverage.response.state, 'partial'); capCursor = page.cursor; assert.ok(++capPages < 200); } while (capCursor && !hitVisited);
  assert.ok(hitVisited, 'visited refs cap is explicit rather than silently dropping endpoints');
  const fast = createSemanticTraceService({ maxWorkMs: 1 });
  const workStore = { ...capStore, storeId: 'work-fixture', getNeighbors: async (...args) => { await new Promise(resolve => setTimeout(resolve, 2)); return capStore.getNeighbors(...args); } };
  const workPage = await fast({ store: workStore, request: capRequest }); assert.ok(workPage.cursor && workPage.frontier.some(row => row.reason === 'work_budget'));
  const altered = { ...artifact, cursorScope: 'different-inventory' }; const scopeService = createSemanticTraceService(); const scopePage = await scopeService({ store: artifact, request: { ...capRequest, seed: refs[0], limits: { records: 1, edges: 1 } } }); await assert.rejects(scopeService({ store: altered, request: { ...capRequest, seed: refs[0], limits: { records: 1, edges: 1 }, cursor: scopePage.cursor } }), { code: 'ERR_SEMANTIC_CURSOR_EXPIRED' });
  console.log('Semantic bounded trace parity passed');
} finally { if (db) db.close(); await fixture.cleanup(); }
