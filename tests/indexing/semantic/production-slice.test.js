#!/usr/bin/env node
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { createSemanticDetailService } from '../../../src/semantic/detail.js';
import { createSqliteSemanticStore } from '../../../src/semantic/sqlite-store.js';
import { openPublishedSemanticStore } from '../../../src/semantic/published-store.js';
import { buildDatabaseFromArtifacts } from '../../../src/storage/sqlite/build/from-artifacts.js';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildIndex } from '../../../src/integrations/core/index.js';
import { getIndexDir, loadUserConfig } from '../../../tools/shared/dict-utils.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { createArtifactSemanticStore } from '../../../src/semantic/artifact-store.js';

const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-semantic-production-'));
const repoRoot = path.join(temp, 'repo');
await fs.mkdir(repoRoot);
const text = 'export function run(buffer) { const view = new Float32Array(buffer, 0, 6); f(1,2,3,4,5,{values:view, items:[1,,3]}); f(7); return view; }';
await fs.writeFile(path.join(repoRoot, 'input.js'), text);
await fs.writeFile(path.join(repoRoot, 'input.ts'), 'export function typed(buffer: ArrayBuffer) { return new Float32Array(buffer, 0, 6); }');
applyTestEnv({ cacheRoot: path.join(temp, 'cache'), embeddings: 'stub', testConfig: {
  indexing: { semantic: { enabled: true, profile: 'rich' }, embeddings: { enabled: false },
    typeInference: false, typeInferenceCrossFile: false, riskAnalysis: false, treeSitter: { enabled: false } }
} });
try {
  await buildIndex(repoRoot, { mode: 'code', stage: 'stage2', incremental: true, 'stub-embeddings': true, 'scm-provider': 'none' });
  const coldDir = getIndexDir(repoRoot, 'code', loadUserConfig(repoRoot));
  const coldManifest = JSON.parse(await fs.readFile(path.join(coldDir, 'semantic_manifest.json'), 'utf8'));
  await buildIndex(repoRoot, { mode: 'code', stage: 'stage2', incremental: true, 'stub-embeddings': true, 'scm-provider': 'none' });
  const outDir = getIndexDir(repoRoot, 'code', loadUserConfig(repoRoot));
  const manifest = JSON.parse(await fs.readFile(path.join(outDir, 'semantic_manifest.json'), 'utf8'));
  assert.equal(manifest.partitions.length, 4);
  assert.ok(manifest.partitions.every(partition => Object.values(partition.members).flat()
    .every(piece => piece.path.startsWith('semantic-cache-'))), 'warm build must relocate durable cache parts rather than recollect syntax');
  assert.notEqual(manifest.generation.baseBuildId, coldManifest.generation.baseBuildId);
  assert.deepEqual(manifest.partitions.map(row => row.canonicalHash).sort(), coldManifest.partitions.map(row => row.canonicalHash).sort(),
    'warm cache relocation preserves canonical facts');
  const store = createArtifactSemanticStore({ root: path.join(outDir, 'semantic'), repoRoot,
    artifactSurfaceVersion: manifest.artifactSurfaceVersion, generation: manifest.generation, partitions: manifest.partitions });
  let partition, tsPartition;
  for (const candidate of manifest.partitions.filter((entry) => entry.partitionId.startsWith('sy1:'))) {
    for await (const source of store.iterateRows(candidate.partitionId, 'semantic_sources')) {
      if (source.path === 'input.js') partition = candidate;
      if (source.path === 'input.ts') tsPartition = candidate;
    }
  }
  assert.ok(tsPartition);
  const tsRows = [];
  for await (const row of store.iterateRows(tsPartition.partitionId, 'semantic_records')) tsRows.push(row);
  assert.equal(tsRows.filter(row => row.data.invocationKind === 'construct').length, 1);
  assert.ok(tsRows.some(row => row.data.syntacticArgumentCount === 3));
  const nodes = [];
  for await (const row of store.iterateRows(partition.partitionId, 'semantic_records')) nodes.push(row);
  const calls = nodes.filter(row => row.kind === 'expression' && row.data.invocationKind);
  assert.equal(calls.length, 3);
  assert.equal(calls.filter(row => row.data.invocationKind === 'construct').length, 1);
  const call = calls.find(row => row.data.syntacticArgumentCount === 6);
  assert.ok(call);
  const operands = [];
  for await (const row of store.iterateRows(partition.partitionId, 'semantic_operands')) operands.push(row);
  assert.equal(operands.filter(row => row.parent.localId === call.id && row.slot === 'argument').length, 6);
  assert.ok(operands.some(row => row.child === null && row.flags.includes('hole')));
  const ref = { partitionId: partition.partitionId, localId: call.id };
  await fs.writeFile(path.join(repoRoot, 'input.js'), '// changed working tree');
  assert.match((await store.getSourceSpans([ref]))[0].text, /f\(1,2,3,4,5/);
  const pieces = JSON.parse(await fs.readFile(path.join(outDir, 'pieces', 'manifest.json'), 'utf8'));
  assert.ok(pieces.pieces.some(piece => piece.name === 'semantic_manifest'));
  const opened = await openPublishedSemanticStore({ indexDir: outDir, repoRoot, generation: manifest.generation });
  const ownership = manifest.partitions.find((entry) => entry.partitionId.startsWith('sa1:') && entry.sourceUnitId === partition.sourceUnitId);
  const joins = [];
  for await (const row of store.iterateRows(ownership.partitionId, 'semantic_ownership')) joins.push(row);
  assert.ok(joins.some((row) => row.recordRef.localId === call.id && row.role === 'primary'));
  const refs = calls.map((row) => ({ partitionId: partition.partitionId, localId: row.id }));
  const request = { repoRoot, generation: manifest.generation, refs, limits: { records: 1 } };
  const detail = createSemanticDetailService();
  const page1 = await detail({ store: opened.store, request });
  assert.equal(page1.records.length, 1);
  assert.ok(page1.cursor);
  assert.equal(page1.coverage.response.state, 'partial');
  assert.ok(page1.coverage.analysis.some((row) => row.state === 'unsupported'));
  const page2 = await detail({ store: opened.store, request: { ...request, cursor: page1.cursor } });
  const page3 = await detail({ store: opened.store, request: { ...request, cursor: page2.cursor } });
  assert.equal(page3.cursor, null);
  assert.deepEqual([...page1.records, ...page2.records, ...page3.records].map(row => row.ref), refs);
  await assert.rejects(detail({ store: opened.store, request: { ...request, fields: ['span'], cursor: page1.cursor } }),
    { code: 'ERR_SEMANTIC_CURSOR_EXPIRED' });
  const dbPath = path.join(temp, 'index.sqlite');
  await buildDatabaseFromArtifacts({ Database, outPath: dbPath, indexDir: outDir, mode: 'code',
    vectorConfig: {}, modelConfig: {}, emitOutput: false, validateMode: 'full', optimize: false });
  const db = new Database(dbPath, { readonly: true });
  try {
    const sqlite = createSqliteSemanticStore({ db, repoRoot, indexPath: dbPath,
      artifactSurfaceVersion: manifest.artifactSurfaceVersion, generation: manifest.generation });
    const sqlitePage = await createSemanticDetailService()({ store: sqlite, request });
    assert.deepEqual({ ...sqlitePage, cursor: null }, { ...page1, cursor: null });
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM semantic_lookup').get().n > 0, true);
  } finally { db.close(); }
  console.log('production semantic collector, publication and exact-source detail passed');
} finally { await fs.rm(temp, { recursive: true, force: true }); }
