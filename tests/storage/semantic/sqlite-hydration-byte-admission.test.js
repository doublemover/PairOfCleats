import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { createRecoveryFixture, semanticNode } from '../../helpers/semantic-recovery.js';
import { createSqliteSemanticStore } from '../../../src/semantic/sqlite-store.js';
import { createSemanticDetailService } from '../../../src/semantic/detail.js';
import { createSemanticTraceService } from '../../../src/semantic/trace.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { SCHEMA_VERSION } from '../../../src/storage/sqlite/schema.js';
import { CREATE_SEMANTIC_TABLES_SQL } from '../../../src/storage/sqlite/semantic/schema.js';
import { writeSqliteIndexFormat } from '../../../src/storage/sqlite/index-format.js';
import { ingestSemanticPartition } from '../../../src/storage/sqlite/semantic/ingest.js';

const fixture = await createRecoveryFixture('call();');
const db = new Database(':memory:');
const ref = localId => ({ partitionId: fixture.partitionId, localId });
const lookup = { kind: 'name', id: 0, value: '雪😀'.repeat(160) };
const occurrence = { id: 1, kind: 'occurrence', span: [0, 4], scope: null,
  data: { nameId: 0, roles: ['call'], expression: ref(0), flags: ['x'.repeat(1400)] } };
const edge = { id: 0, kind: 'reads', from: ref(0), to: ref(1), callSite: null,
  operandOrdinal: null, contextKey: 'x'.repeat(1400), condition: null, evidence: null, certainty: 'exact-static' };
const operand = ordinal => ({ parent: ref(0), slot: ordinal ? 'argument' : `ast:${'X'.repeat(1400)}.value`,
  ordinal, child: ref(1), flags: [] });
const ownership = { recordRef: ref(0), chunkUid: 'x'.repeat(1400), role: 'primary' };
const oversized = { semantic_lookup: lookup, semantic_records: occurrence, semantic_edges: edge,
  semantic_operands: operand(0), semantic_ownership: ownership };
const make = options => createSqliteSemanticStore({ db, repoRoot: fixture.root, indexPath: ':memory:',
  generation: fixture.generation, artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, ...options });
try {
  const descriptor = await fixture.write([semanticNode(0, 7), { family: 'node', row: occurrence },
    { family: 'lookup', row: lookup }, { family: 'edge', row: edge },
    ...[0, 1, 2, 3].map(ordinal => ({ family: 'operand', row: operand(ordinal) })),
    { family: 'ownership', row: ownership }]);
  db.pragma('user_version = ' + SCHEMA_VERSION); db.exec(CREATE_SEMANTIC_TABLES_SQL); writeSqliteIndexFormat(db);
  await ingestSemanticPartition({ db, store: fixture.store([descriptor]), descriptor });
  db.prepare('INSERT INTO index_format_meta(key,value) VALUES (?,?)').run('semanticGeneration', JSON.stringify(fixture.generation));
  const limited = make({ maxRowBytes: 1024 });
  assert.ok(JSON.stringify(lookup).length < 1024);
  assert.ok(Buffer.byteLength(JSON.stringify(lookup)) > 1024, 'UTF-8 bytes differ from UTF-16 string length');
  for (const member of Object.keys(oversized)) {
    const metrics = {};
    await assert.rejects(limited.getRelatedPage(ref(0), member, { limit: 1, metrics }), { code: 'ERR_SEMANTIC_OUTPUT_LIMIT' });
    assert.equal(metrics.hydratedRows || 0, 0, member + ' rejects before exporting/parsing payload text');
    assert.equal(metrics.hydratedBytes || 0, 0);
  }
  await assert.rejects(limited.getRecords([ref(1)]), { code: 'ERR_SEMANTIC_OUTPUT_LIMIT' });
  for (const [member, row] of Object.entries(oversized)) {
    const payload = db.prepare(`SELECT payload FROM ${member}${member === 'semantic_records' ? " WHERE record_kind='occurrence'" : ''} ORDER BY rowid LIMIT 1`).get().payload;
    const bytes = Buffer.byteLength(payload);
    const metrics = {};
    const page = await make({ maxRowBytes: bytes }).getRelatedPage(ref(0), member, { limit: 1, metrics });
    assert.equal(page.rows.length, 1); assert.equal(page.offset, 1);
    assert.equal(metrics.hydratedRows, 1); assert.equal(metrics.hydratedBytes, bytes);
    if (member === 'semantic_lookup') assert.equal(page.rows[0].value, row.value);
    await assert.rejects(make({ maxRowBytes: bytes - 1 }).getRelatedPage(ref(0), member, { limit: 1 }), { code: 'ERR_SEMANTIC_OUTPUT_LIMIT' });
  }
  const smallBytes = db.prepare('SELECT length(CAST(payload AS BLOB)) AS bytes FROM semantic_operands ORDER BY rowid LIMIT 1 OFFSET 1').get().bytes;
  const pageLimited = make({ maxRowBytes: smallBytes, maxHydrationBytes: smallBytes * 2 });
  const metrics = {};
  await assert.rejects(pageLimited.getRelatedPage(ref(0), 'semantic_operands', { offset: 1, limit: 3, metrics }), { code: 'ERR_SEMANTIC_OUTPUT_LIMIT' });
  assert.equal(metrics.hydratedRows || 0, 0, 'aggregate admission occurs before the first payload leaves SQLite');
  const first = await pageLimited.getRelatedPage(ref(0), 'semantic_operands', { offset: 1, limit: 2 });
  assert.deepEqual(first.rows.map(row => row.ordinal), [1, 2]); assert.equal(first.offset, 3); assert.equal(first.done, false);
  const last = await pageLimited.getRelatedPage(ref(0), 'semantic_operands', { offset: first.offset, limit: 2 });
  assert.deepEqual(last.rows.map(row => row.ordinal), [3]); assert.equal(last.done, true);
  const request = { repoRoot: fixture.root, generation: fixture.generation, refs: [ref(0)], include: ['names'] };
  await assert.rejects(createSemanticDetailService()({ store: limited, request }), { code: 'ERR_SEMANTIC_OUTPUT_LIMIT' });
  await assert.rejects(createSemanticTraceService()({ store: limited, request: {
    repoRoot: fixture.root, generation: fixture.generation, seed: ref(0), direction: 'downstream', kinds: ['reads']
  } }), { code: 'ERR_SEMANTIC_OUTPUT_LIMIT' });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(limited.getRelatedPage(ref(0), 'semantic_lookup', { signal: controller.signal }), { name: 'AbortError' });
  // This member has no JSON-expression index. Corruption must remain an
  // integrity failure, independently of encoded byte admission.
  db.prepare('UPDATE semantic_lookup SET payload=? WHERE partition_id=? AND local_id=0').run('{broken', fixture.partitionId);
  await assert.rejects(make({ maxRowBytes: 1024 }).getRelatedPage(ref(0), 'semantic_lookup'), { code: 'ERR_SEMANTIC_INTEGRITY' });
  assert.throws(() => make({ maxHydrationBytes: 0 }), /hydration allowance/);
} finally { db.close(); await fixture.cleanup(); }
console.log('SQLite semantic payloads enforce UTF-8 row and aggregate admission before hydration.');
