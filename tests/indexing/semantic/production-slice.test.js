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
import { createSemanticTaskId, semanticHash } from '../../../src/index/semantic/identity.js';

const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-semantic-production-'));
const repoRoot = path.join(temp, 'repo');
await fs.mkdir(repoRoot);
const text = 'export function run(buffer) { const view = new Float32Array(buffer, 0, 6); f(1,2,3,4,5,{values:view, items:[1,,3]}); f(7); return view; }';
await fs.writeFile(path.join(repoRoot, 'input.js'), text);
await fs.writeFile(path.join(repoRoot, 'input.ts'), 'export function typed(buffer: ArrayBuffer) { return new Float32Array(buffer, 0, 6); }');
applyTestEnv({ cacheRoot: path.join(temp, 'cache'), embeddings: 'stub', testConfig: {
  indexing: { semantic: { enabled: true, profile: 'rich', enrichment: { bindings: 'off' } }, embeddings: { enabled: false },
    typeInference: false, typeInferenceCrossFile: false, riskAnalysis: false, treeSitter: { enabled: false } }
} });
try {
  await buildIndex(repoRoot, { mode: 'code', stage: 'stage2', incremental: true, 'stub-embeddings': true, 'scm-provider': 'none' });
  const coldDir = getIndexDir(repoRoot, 'code', loadUserConfig(repoRoot));
  const coldManifest = JSON.parse(await fs.readFile(path.join(coldDir, 'semantic_manifest.json'), 'utf8'));
  await buildIndex(repoRoot, { mode: 'code', stage: 'stage2', incremental: true, 'stub-embeddings': true, 'scm-provider': 'none' });
  const outDir = getIndexDir(repoRoot, 'code', loadUserConfig(repoRoot));
  const manifest = JSON.parse(await fs.readFile(path.join(outDir, 'semantic_manifest.json'), 'utf8'));
  const syntaxPartitions = manifest.partitions.filter(partition => partition.partitionId.startsWith('sy1:'));
  const ownershipPartitions = manifest.partitions.filter(partition => partition.members.semantic_ownership.some(piece => piece.count > 0));
  const decisionPartitions = manifest.partitions.filter(partition => partition.partitionId.startsWith('sa1:')
    && partition.members.semantic_coverage.some(piece => piece.count > 0));
  assert.equal(syntaxPartitions.length, 2, 'one immutable syntax partition per input source');
  assert.equal(ownershipPartitions.length, 2, 'one ownership partition per input source');
  assert.equal(decisionPartitions.length, 4, 'local/cross-file dependency decisions remain explicit for both sources');
  assert.equal(manifest.partitions.length, syntaxPartitions.length + ownershipPartitions.length + decisionPartitions.length,
    'every production partition has a checked coverage owner');
  assert.ok([...syntaxPartitions, ...ownershipPartitions].every(partition => Object.values(partition.members).flat()
    .every(piece => piece.path.startsWith('semantic-cache-'))), 'warm build must relocate durable cache parts rather than recollect syntax');
  assert.notEqual(manifest.generation.baseBuildId, coldManifest.generation.baseBuildId);
  const cachedPartitions = [...syntaxPartitions, ...ownershipPartitions];
  assert.deepEqual(cachedPartitions.map(row => row.canonicalHash).sort(),
    coldManifest.partitions.filter(row => cachedPartitions.some(partition => partition.partitionId === row.partitionId))
      .map(row => row.canonicalHash).sort(), 'warm cache relocation preserves exact syntax and ownership facts');
  const store = createArtifactSemanticStore({ root: path.join(outDir, 'semantic'), repoRoot,
    artifactSurfaceVersion: manifest.artifactSurfaceVersion, generation: manifest.generation, partitions: manifest.partitions });
  const collectDecisions = async (indexDir, family) => {
    const familyStore = createArtifactSemanticStore({ root: path.join(indexDir, 'semantic'), repoRoot,
      artifactSurfaceVersion: family.artifactSurfaceVersion, generation: family.generation, partitions: family.partitions });
    const tasks = new Map(), decisions = [];
    for (const partition of family.partitions.filter(row => row.partitionId.startsWith('sa1:'))) {
      for await (const task of familyStore.iterateRows(partition.partitionId, 'semantic_frontier')) {
        assert.equal(task.baseBuildId, family.generation.baseBuildId);
        const target = JSON.parse(await fs.readFile(path.join(indexDir, 'semantic', task.targetsRef), 'utf8'));
        assert.deepEqual(target.generation, family.generation, 'frontier targets are pinned to their own build');
        assert.equal(semanticHash('pairofcleats.semantic.binding-targets.v1', target), task.targetSetHash);
        const { kind, inputHashes, policyHash, targetSetHash } = task;
        assert.equal(createSemanticTaskId({ kind, inputHashes, policyHash, targetSetHash }), task.taskId,
          'task identity includes the generation-pinned target hash');
        tasks.set(task.taskId, { task, target });
      }
      for await (const row of familyStore.iterateRows(partition.partitionId, 'semantic_coverage')) decisions.push(row);
    }
    assert.ok(decisions.every(row => tasks.has(row.frontierRef)), 'every decision cites its durable task');
    return { tasks, decisions };
  };
  const coldDecisions = await collectDecisions(coldDir, coldManifest);
  const warmDecisions = await collectDecisions(outDir, manifest);
  assert.equal(coldDecisions.tasks.size, 2);
  assert.equal(warmDecisions.tasks.size, 2);
  for (const [id, { task, target }] of warmDecisions.tasks) {
    assert.ok(!coldDecisions.tasks.has(id), 'a fresh build must not reuse an executable task identity');
    const prior = [...coldDecisions.tasks.values()].find(value => value.task.kind === task.kind);
    assert.deepEqual({ ...target, generation: null }, { ...prior.target, generation: null },
      'only the invocation generation changes in otherwise identical frontier targets');
  }
  const decisionContent = rows => rows.map(({ frontierRef, ...content }) => JSON.stringify(content)).sort();
  assert.deepEqual(decisionContent(warmDecisions.decisions), decisionContent(coldDecisions.decisions),
    'coverage content remains identical after separately verifying generation-dependent frontier identities');
  for (const syntax of syntaxPartitions) {
    const decisions = [];
    for (const decision of decisionPartitions.filter(row => row.sourceUnitId === syntax.sourceUnitId)) {
      for await (const coverage of store.iterateRows(decision.partitionId, 'semantic_coverage')) decisions.push(coverage);
    }
    assert.deepEqual(decisions.map(row => row.phase).sort(), ['crossFileFlow', 'localFlow']);
    assert.ok(decisions.every(row => row.state === 'disabled' && row.reason === 'analysis_dependency_disabled'));
  }
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
  const ownership = ownershipPartitions.find(entry => entry.sourceUnitId === partition.sourceUnitId);
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
