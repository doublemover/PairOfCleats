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

console.log('phase usage checklist test passed');
