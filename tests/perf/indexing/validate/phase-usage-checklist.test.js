#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { applyTestEnv } from '../../../helpers/test-env.js';
import { getIndexDir, resolveRepoConfig } from '../../../../tools/shared/dict-utils.js';
import { MAX_JSON_BYTES, loadChunkMeta, loadPiecesManifest } from '../../../../src/shared/artifact-io.js';
import { buildCodeMap } from '../../../../src/map/build-map.js';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'phase-usage-checklist');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(path.join(repoRoot, 'src'), { recursive: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });

await fsPromises.writeFile(
  path.join(repoRoot, 'src', 'alpha.js'),
  'export function alpha() { return 1; }\n'
);
await fsPromises.writeFile(
  path.join(repoRoot, 'src', 'beta.js'),
  'import { alpha } from \"./alpha.js\";\n' +
    'export function beta() { return alpha(); }\n'
);

const env = applyTestEnv({
  cacheRoot,
  embeddings: 'stub',
  testConfig: {
    indexing: {
      scm: { provider: 'none' }
    }
  }
});

const buildIndexPath = path.join(root, 'build_index.js');
const buildResult = spawnSync(
  process.execPath,
  [buildIndexPath, '--stub-embeddings', '--sqlite', '--mode', 'code', '--repo', repoRoot],
  { cwd: repoRoot, env, stdio: 'inherit' }
);

if (buildResult.status !== 0) {
  console.error('Failed: build index for phase usage checklist test');
  process.exit(buildResult.status ?? 1);
}

const { userConfig } = resolveRepoConfig(repoRoot);
const indexDir = getIndexDir(repoRoot, 'code', userConfig, {});
assert.ok(indexDir, 'expected code indexDir');
const buildRoot = path.dirname(indexDir);
const repoCacheRoot = path.dirname(path.dirname(buildRoot));
const readJson = async (filePath) => JSON.parse(await fsPromises.readFile(filePath, 'utf8'));

const buildState = await readJson(path.join(buildRoot, 'build_state.json'));
assert.equal(buildState.stage, 'stage4', 'expected Stage4 completion in build_state');
assert.equal(buildState.phases?.stage2?.status, 'done');
assert.equal(buildState.phases?.stage3?.status, 'done');
assert.equal(buildState.phases?.stage4?.status, 'done');
assert.ok(buildState.orderingLedger?.schemaVersion >= 1, 'expected ordering ledger');

const stageCheckpoints = await readJson(path.join(buildRoot, 'build_state.stage-checkpoints.json'));
assert.ok(stageCheckpoints?.code?.multi?.checkpoints?.length > 0, 'expected multi-stage checkpoints');
assert.ok(stageCheckpoints?.code?.stage3?.checkpoints?.length > 0, 'expected stage3 checkpoints');
assert.ok(stageCheckpoints?.code?.stage4?.checkpoints?.length > 0, 'expected stage4 checkpoints');

const findCheckpoint = (collection, predicate) => (
  Array.isArray(collection) ? collection.find(predicate) : null
);
const multiCheckpoints = stageCheckpoints.code.multi.checkpoints;
const stage3Checkpoints = stageCheckpoints.code.stage3.checkpoints;
const stage4Checkpoints = stageCheckpoints.code.stage4.checkpoints;

const stage1Processing = findCheckpoint(
  multiCheckpoints,
  (entry) => entry?.stage === 'stage1' && entry?.step === 'processing'
);
assert.ok(stage1Processing, 'expected stage1 processing checkpoint');
assert.ok(
  Number.isFinite(stage1Processing?.extra?.postingsQueue?.highWater?.bytes),
  'expected measured postings queue bytes in stage1'
);

const stage2ChunkMetaArtifact = findCheckpoint(
  multiCheckpoints,
  (entry) => entry?.stage === 'stage2' && entry?.step === 'artifact' && entry?.label === 'chunk_meta'
);
assert.ok(stage2ChunkMetaArtifact, 'expected stage2 chunk_meta artifact checkpoint');
assert.ok(
  Number.isFinite(stage2ChunkMetaArtifact?.extra?.budget?.usedBytes),
  'expected stage2 artifact budget telemetry'
);

const stage2Write = findCheckpoint(
  multiCheckpoints,
  (entry) => entry?.stage === 'stage2' && entry?.step === 'write'
);
assert.ok(stage2Write, 'expected stage2 write checkpoint');
assert.ok(
  Number.isFinite(stage2Write?.extra?.vfsManifest?.rows),
  'expected vfs manifest telemetry in stage2 write checkpoint'
);

const stage3Vectors = findCheckpoint(
  stage3Checkpoints,
  (entry) => entry?.stage === 'stage3' && entry?.step === 'vectors-filled'
);
assert.ok(stage3Vectors, 'expected stage3 vectors-filled checkpoint');
assert.ok(
  Number.isFinite(stage3Vectors?.extra?.vectors?.merged),
  'expected stage3 vector count signal'
);

const stage4Build = findCheckpoint(
  stage4Checkpoints,
  (entry) => entry?.stage === 'stage4' && entry?.step === 'build'
);
assert.ok(stage4Build, 'expected stage4 build checkpoint');
assert.ok(
  Number.isFinite(stage4Build?.extra?.outputBytes) && stage4Build.extra.outputBytes > 0,
  'expected stage4 output bytes signal'
);

const requiredArtifacts = [
  path.join(indexDir, 'vfs_manifest.vfsidx'),
  path.join(indexDir, 'vfs_manifest.vfsbloom.json'),
  path.join(indexDir, 'tree-sitter', 'plan.json'),
  path.join(indexDir, 'minhash_signatures.packed.meta.json'),
  path.join(buildRoot, 'index-sqlite', 'index-code.db')
];
for (const artifactPath of requiredArtifacts) {
  const stats = await fsPromises.stat(artifactPath);
  assert.ok(stats.isFile(), `expected artifact file: ${artifactPath}`);
}

const manifest = loadPiecesManifest(indexDir, { maxBytes: MAX_JSON_BYTES, strict: true });
assert.ok(manifest, 'expected pieces manifest to load');

const chunkMeta = await loadChunkMeta(indexDir, { maxBytes: MAX_JSON_BYTES, strict: true, manifest });
assert.ok(Array.isArray(chunkMeta) && chunkMeta.length > 0, 'expected chunk_meta rows');

const mapModel = await buildCodeMap({ repoRoot, indexDir, options: { mode: 'code' } });
assert.ok(Array.isArray(mapModel?.nodes) && mapModel.nodes.length > 0, 'expected map nodes');

const searchPath = path.join(root, 'search.js');
const searchArgs = ['alpha', '--mode', 'code', '--json', '--no-ann', '--repo', repoRoot];

const memoryResult = spawnSync(
  process.execPath,
  [searchPath, ...searchArgs, '--backend', 'memory'],
  { cwd: repoRoot, env, encoding: 'utf8' }
);
if (memoryResult.status !== 0) {
  console.error(memoryResult.stdout || '');
  console.error(memoryResult.stderr || '');
  process.exit(memoryResult.status ?? 1);
}
const memoryEnvelope = JSON.parse(String(memoryResult.stdout || '{}'));
assert.equal(memoryEnvelope.backend, 'memory');
assert.ok(Array.isArray(memoryEnvelope.code) && memoryEnvelope.code.length > 0, 'expected memory code hits');

const sqliteResult = spawnSync(
  process.execPath,
  [searchPath, ...searchArgs, '--backend', 'sqlite'],
  { cwd: repoRoot, env, encoding: 'utf8' }
);
if (sqliteResult.status !== 0) {
  console.error(sqliteResult.stdout || '');
  console.error(sqliteResult.stderr || '');
  process.exit(sqliteResult.status ?? 1);
}
const sqliteEnvelope = JSON.parse(String(sqliteResult.stdout || '{}'));
assert.equal(sqliteEnvelope.backend, 'sqlite');
assert.ok(Array.isArray(sqliteEnvelope.code) && sqliteEnvelope.code.length > 0, 'expected sqlite code hits');

const queryCachePath = path.join(repoCacheRoot, 'query-cache', 'queryCache.json');
const queryPlanCachePath = path.join(repoCacheRoot, 'query-cache', 'queryPlanCache.json');
const queryCache = await readJson(queryCachePath);
const queryPlanCache = await readJson(queryPlanCachePath);
assert.ok(Array.isArray(queryCache?.entries) && queryCache.entries.length > 0, 'expected query cache entries');
assert.ok(Array.isArray(queryPlanCache?.entries) && queryPlanCache.entries.length > 0, 'expected query plan cache entries');

console.log('phase usage checklist test passed');
